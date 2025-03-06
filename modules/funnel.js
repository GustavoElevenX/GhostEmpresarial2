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
    if (process.send) process.send({ type: 'leadMoved', contactId, stage });
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
  try {
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

    await db.logInteraction({ contact_id: contactId, source, message, response: aiResponse });

    if (source === 'whatsapp' && whatsappClient) {
      await whatsapp.sendMessage(whatsappNumber, aiResponse);
    } else if (source === 'gmail' && gmailClient && contact.email) {
      await gmail.sendEmail(gmailClient, { to: contact.email, subject: 'Resposta Automática', message: aiResponse });
    }

    if (currentStage === STAGES.CONTATO_INICIAL) {
      await moveToStage(contactId, STAGES.RESPOSTA);
    } else if (currentStage === STAGES.RESPOSTA) {
      const msgLower = message.toLowerCase();
      if (msgLower.includes('sim') || msgLower.includes('quero') || msgLower.includes('ajude')) {
        await moveToStage(contactId, STAGES.LEAD_QUENTE);
      } else {
        await moveToStage(contactId, STAGES.LEADS_ESQUECERAM);
      }
    } else if (currentStage === STAGES.LEAD_QUENTE || currentStage === STAGES.LEADS_ESQUECERAM) {
      const msgLower = message.toLowerCase();
      if (msgLower.includes('agendar') || msgLower.includes('reunião') || msgLower.includes('sim')) {
        await moveToStage(contactId, STAGES.REUNIAO_AGENDADA);
        const dateTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        await db.addAppointment({ contact_id: contactId, date_time: dateTime });
        const appointmentMessage = `Perfeito! Vamos agendar sua reunião. Aqui estão as opções:\n- Segunda a Sexta: 9:00 às 16:00 (horário cheio)\n- Sábado: 9:00 às 11:00 (horário cheio)\n- Domingo: sem disponibilidade\nMe diga o dia e horário que prefere!`;
        if (source === 'whatsapp') {
          await whatsapp.sendMessage(whatsappNumber, appointmentMessage);
          await notifications.notifyNewAppointment(whatsappClient, gmailClient, contactId, dateTime);
        } else if (source === 'gmail' && contact.email) {
          await gmail.sendEmail(gmailClient, { to: contact.email, subject: 'Reunião Agendada', message: appointmentMessage });
          await notifications.notifyNewAppointment(whatsappClient, gmailClient, contactId, dateTime);
        }
      } else if (currentStage === STAGES.LEAD_QUENTE) {
        await moveToStage(contactId, STAGES.LEADS_ESQUECERAM);
      }
    } else if (currentStage === STAGES.REUNIAO_AGENDADA) {
      console.log(`Contato ${contactId} já tem reunião agendada.`);
    }

    return aiResponse;
  } catch (error) {
    console.error(`Erro ao processar interação para ${whatsappNumber}:`, error);
    return 'Erro ao processar sua mensagem. Tente novamente.';
  }
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
      const leads = await db.all(`
        SELECT c.id, c.phone, i.timestamp 
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
  try {
    await db.initializeDatabase();
    console.log('Banco de dados inicializado no funil.');

    whatsappClient.on('message', async (msg) => {
      await processInteraction({
        whatsappNumber: msg.from,
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
    console.log('Funil de vendas inicializado com sucesso!');
  } catch (error) {
    console.error('Erro ao inicializar o funil:', error);
    throw error;
  }
}

if (process.send) {
  let whatsappClient;
  let gmailClient;
  let dbReady = false;

  (async () => {
    try {
      console.log('Iniciando processo filho...');
      await db.initializeDatabase();
      dbReady = true;
      console.log('Banco de dados pronto no processo filho.');

      whatsappClient = await whatsapp.initializeWhatsApp();
      gmailClient = await gmail.initializeGmail();
      await initializeFunnel(whatsappClient, gmailClient);
      console.log('Funil de vendas inicializado no processo filho!');
      process.send({ type: 'funnelReady' });
    } catch (error) {
      console.error('Erro ao inicializar o funil:', error);
      if (process.send) process.send({ type: 'error', message: error.message });
      process.exit(1);
    }
  })();

  process.on('message', async (msg) => {
    if (!dbReady) {
      console.log('Aguardando inicialização do banco de dados...');
      process.send({ type: 'error', message: 'Banco de dados ainda não inicializado' });
      return;
    }

    try {
      if (msg.action === 'moveLead') {
        await moveToStage(msg.contactId, msg.stage);
        if (msg.stage === STAGES.REUNIAO_AGENDADA) {
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
        process.send({ type: 'leadsData', data: leads });
      } else if (msg.action === 'loadAppointments') {
        const appointments = await db.all(`
          SELECT a.id, c.name, c.phone, a.date_time 
          FROM appointments a 
          JOIN contacts c ON a.contact_id = c.id 
          ORDER BY a.date_time ASC
        `);
        process.send({ type: 'appointmentsData', data: appointments });
      }
    } catch (error) {
      console.error('Erro ao processar mensagem do processo pai:', error);
      process.send({ type: 'error', message: error.message });
    }
  });
}

module.exports = {
  STAGES,
  moveToStage,
  processInteraction,
  initializeFunnel
};