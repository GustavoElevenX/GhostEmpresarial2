const db = require('./database');
const ai = require('./ai');
const whatsapp = require('./whatsapp');
const gmail = require('./gmail');
const notifications = require('./notifications');

const STAGES = {
  CONTATO_INICIAL: 'contato_inicial',
  RESPOSTA: 'resposta',
  LEAD_QUENTE: 'lead_quente',
  LEADS_ESQUECERAM: 'leads_esqueceram',
  REUNIAO_AGENDADA: 'reuniao_agendada'
};

async function moveToStage(contactId, stage) {
  try {
    await db.updateFunnelStage({ contact_id: contactId, stage });
    console.log(`Contato ${contactId} movido para a etapa: ${stage}`);
    process.send({ type: 'leadMoved', contactId, stage });
    return true;
  } catch (error) {
    console.error(`Erro ao mover contato ${contactId} para ${stage}:`, error);
    return false;
  }
}

async function sendNurtureMessage(whatsappNumber, message, whatsappClient) {
  try {
    await whatsapp.sendMessage(whatsappNumber, message);
    console.log(`[Nutrição] Mensagem enviada para ${whatsappNumber}: "${message}"`);
  } catch (error) {
    console.error(`Erro ao enviar mensagem de nutrição para ${whatsappNumber}:`, error);
  }
}

async function processInteraction({ whatsappNumber, message, source, whatsappClient, gmailClient }) {
  const contact = await db.getContact({ phone: whatsappNumber }) || await db.upsertContact({
    name: 'Desconhecido',
    phone: whatsappNumber,
    email: null
  });
  const contactId = contact.id;

  const currentStage = await db.getFunnelStage(contactId) || STAGES.CONTATO_INICIAL;

  let aiResponse = await ai.handleInteraction(whatsappNumber, message, source);
  aiResponse = typeof aiResponse === 'string' ? aiResponse : 'Desculpe, não consegui gerar uma resposta válida.';
  console.log(`[Debug] Resposta da IA: "${aiResponse}"`);

  try {
    await db.logInteraction({
      contact_id: contactId,
      source,
      message,
      response: aiResponse
    });

    if (source === 'whatsapp' && whatsappClient) {
      console.log(`[Debug] Enviando mensagem para ${whatsappNumber}: "${aiResponse}"`);
      await whatsapp.sendMessage(whatsappNumber, aiResponse);
    } else if (source === 'gmail' && gmailClient) {
      if (contact && contact.email) {
        await gmail.sendEmail(gmailClient, {
          to: contact.email,
          subject: 'Resposta Automática',
          message: aiResponse
        });
      }
    }

    if (currentStage === STAGES.CONTATO_INICIAL) {
      await moveToStage(contactId, STAGES.RESPOSTA);
    } else if (currentStage === STAGES.RESPOSTA) {
      if (message.toLowerCase().includes('sim') || message.toLowerCase().includes('quero') || message.toLowerCase().includes('ajude')) {
        await moveToStage(contactId, STAGES.LEAD_QUENTE);
      } else {
        await moveToStage(contactId, STAGES.LEADS_ESQUECERAM);
      }
    } else if (currentStage === STAGES.LEAD_QUENTE || currentStage === STAGES.LEADS_ESQUECERAM) {
      if (message.toLowerCase().includes('agendar') || message.toLowerCase().includes('reunião') || message.toLowerCase().includes('sim')) {
        await moveToStage(contactId, STAGES.REUNIAO_AGENDADA);
        const dateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db.addAppointment({ contact_id: contactId, date_time: dateTime });
        const appointmentMessage = `Perfeito! Vamos agendar sua reunião. Aqui estão as opções:\n- Segunda a Sexta: 9:00 às 16:00 (horário cheio)\n- Sábado: 9:00 às 11:00 (horário cheio)\n- Domingo: sem disponibilidade\nMe diga o dia e horário que prefere!`;
        if (source === 'whatsapp') {
          await whatsapp.sendMessage(whatsappNumber, appointmentMessage);
          await notifications.notifyNewAppointment(whatsappClient, gmailClient, contactId, dateTime);
        } else if (source === 'gmail' && contact && contact.email) {
          await gmail.sendEmail(gmailClient, {
            to: contact.email,
            subject: 'Reunião Agendada',
            message: appointmentMessage
          });
          await notifications.notifyNewAppointment(whatsappClient, gmailClient, contactId, dateTime);
        }
      } else if (currentStage === STAGES.LEAD_QUENTE) {
        await moveToStage(contactId, STAGES.LEADS_ESQUECERAM);
      }
    } else if (currentStage === STAGES.REUNIAO_AGENDADA) {
      console.log(`Contato ${contactId} já tem reunião agendada.`);
    }
  } catch (error) {
    console.error(`Erro ao processar interação para ${whatsappNumber}:`, error);
  }

  return aiResponse;
}

async function nurtureLeads(whatsappClient) {
  const intervals = [2, 5, 7, 15];
  const messages = [
    'Oi! Tudo bem? Ainda estamos aqui para te ajudar com suas vendas. Quer conversar?',
    'Olá! Não te esqueci! Está precisando de algo para o seu negócio?',
    'Oi de novo! Vamos transformar suas vendas? Só dizer "sim"!',
    'Última chance! Se quiser ajuda, é só dizer "sim". Caso contrário, até logo!'
  ];

  setInterval(async () => {
    try {
      const leads = await db.all(`SELECT c.phone, i.timestamp 
                                  FROM contacts c 
                                  JOIN interactions i ON c.id = i.contact_id 
                                  JOIN sales_funnel f ON c.id = f.contact_id 
                                  WHERE f.stage = ?`, [STAGES.LEADS_ESQUECERAM]);
      for (const lead of leads) {
        const firstContact = new Date(lead.timestamp);
        const daysSinceContact = Math.floor((Date.now() - firstContact) / (1000 * 60 * 60 * 24));
        
        for (let i = 0; i < intervals.length; i++) {
          if (daysSinceContact === intervals[i]) {
            await sendNurtureMessage(lead.phone, messages[i], whatsappClient);
          }
        }
        if (daysSinceContact >= 15) {
          await moveToStage(lead.id, 'descartado');
          console.log(`Lead ${lead.phone} descartado após 15 dias sem resposta.`);
        }
      }
    } catch (error) {
      console.error('Erro na nutrição de leads:', error);
    }
  }, 24 * 60 * 60 * 1000);
}

async function initializeFunnel(whatsappClient, gmailClient) {
  whatsappClient.on('message', async (msg) => {
    const whatsappNumber = msg.from;
    await processInteraction({
      whatsappNumber,
      message: msg.body,
      source: 'whatsapp',
      whatsappClient,
      gmailClient
    });
  });

  setInterval(async () => {
    try {
      await gmail.checkEmails(gmailClient, db);
    } catch (error) {
      console.error('Erro ao verificar e-mails no Gmail:', error);
    }
  }, 60000);

  await nurtureLeads(whatsappClient);
  await notifications.initializeNotifications(whatsappClient, gmailClient);
}

if (process.send) {
  let whatsappClient;
  let gmailClient;

  (async () => {
    try {
      await db.initializeDatabase(); // Espera o banco estar pronto
      whatsappClient = await whatsapp.initializeWhatsApp();
      gmailClient = await gmail.initializeGmail();
      await initializeFunnel(whatsappClient, gmailClient);
      console.log('Funil de vendas inicializado no processo filho!');
    } catch (error) {
      console.error('Erro ao inicializar o funil:', error);
      process.send({ type: 'error', message: error.message });
      process.exit(1);
    }
  })();

  process.on('message', async (msg) => {
    if (msg.action === 'moveLead') {
      await moveToStage(msg.contactId, msg.stage);
      if (msg.stage === 'reuniao_agendada') {
        const dateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db.addAppointment({ contact_id: msg.contactId, date_time: dateTime });
      }
    } else if (msg.action === 'loadLeads') {
      const leads = await db.all(`
        SELECT c.id, c.name, c.phone, f.stage, MAX(i.timestamp) as timestamp 
        FROM contacts c 
        LEFT JOIN sales_funnel f ON c.id = f.contact_id 
        LEFT JOIN interactions i ON c.id = i.contact_id 
        GROUP BY c.id, c.name, c.phone, f.stage 
        ORDER BY i.timestamp DESC
      `);
      const utf8Leads = leads.map(lead => ({
        ...lead,
        name: Buffer.from(lead.name, 'utf8').toString('utf8')
      }));
      process.send({ type: 'leadsData', data: utf8Leads });
    } else if (msg.action === 'loadAppointments') {
      const appointments = await db.all(`
        SELECT a.id, c.name, c.phone, a.date_time 
        FROM appointments a 
        JOIN contacts c ON a.contact_id = c.id 
        ORDER BY a.date_time ASC
      `);
      const utf8Appointments = appointments.map(appt => ({
        ...appt,
        name: Buffer.from(appt.name, 'utf8').toString('utf8')
      }));
      process.send({ type: 'appointmentsData', data: utf8Appointments });
    }
  });
}

module.exports = {
  STAGES,
  moveToStage,
  processInteraction,
  initializeFunnel
};