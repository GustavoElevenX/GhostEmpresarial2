const db = require('./database');
const whatsapp = require('./whatsapp');
const gmail = require('./gmail');

// Configurações do administrador (ajuste conforme necessário)
const ADMIN_PHONE = '5598992302212@c.us'; // Número do WhatsApp do administrador
const ADMIN_EMAIL = 'l.gustavo2212@hotmail.com'; // E-mail do administrador

// Função para enviar notificação via WhatsApp
async function sendWhatsAppNotification(whatsappClient, message) {
  try {
    await whatsapp.sendMessage(ADMIN_PHONE, message);
    console.log(`[Notificação WhatsApp] Enviada para ${ADMIN_PHONE}: "${message}"`);
  } catch (error) {
    console.error(`Erro ao enviar notificação WhatsApp para ${ADMIN_PHONE}:`, error);
  }
}

// Função para enviar notificação via Gmail
async function sendEmailNotification(gmailClient, subject, message) {
  try {
    await gmail.sendEmail(gmailClient, {
      to: ADMIN_EMAIL,
      subject,
      message
    });
    console.log(`[Notificação Email] Enviada para ${ADMIN_EMAIL}: "${subject}"`);
  } catch (error) {
    console.error(`Erro ao enviar notificação Email para ${ADMIN_EMAIL}:`, error);
  }
}

// Função para verificar reuniões agendadas
async function checkAppointments(whatsappClient, gmailClient) {
  const now = Date.now();
  const oneHourAhead = now + 60 * 60 * 1000; // 1 hora à frente
  const oneDayAhead = now + 24 * 60 * 60 * 1000; // 24 horas à frente

  try {
    const appointments = await db.all(`
      SELECT a.id, a.contact_id, a.date_time, c.phone, c.name 
      FROM appointments a 
      JOIN contacts c ON a.contact_id = c.id 
      WHERE a.date_time BETWEEN ? AND ?
    `, [now, oneDayAhead]);

    for (const appt of appointments) {
      const apptTime = new Date(appt.date_time).getTime();
      const timeDiff = apptTime - now;

      let message;
      if (timeDiff <= 60 * 60 * 1000 && timeDiff > 0) {
        message = `Lembrete: Reunião com ${appt.name} (${appt.phone}) em 1 hora (${appt.date_time}).`;
      } else if (timeDiff <= 24 * 60 * 60 * 1000 && timeDiff > 23 * 60 * 60 * 1000) {
        message = `Aviso: Reunião com ${appt.name} (${appt.phone}) amanhã (${appt.date_time}). Prepare-se!`;
      }

      if (message) {
        await sendWhatsAppNotification(whatsappClient, message);
        await sendEmailNotification(gmailClient, 'Lembrete de Reunião', message);
      }
    }
  } catch (error) {
    console.error('Erro ao verificar reuniões agendadas:', error);
  }
}

// Função para verificar leads descartados
async function checkDiscardedLeads(whatsappClient, gmailClient) {
  try {
    const discarded = await db.all(`
      SELECT c.phone, c.name 
      FROM contacts c 
      JOIN sales_funnel f ON c.id = f.contact_id 
      WHERE f.stage = 'descartado' 
      AND f.updated_at > datetime('now', '-1 hour')
    `);

    for (const lead of discarded) {
      const message = `Lead descartado: ${lead.name} (${lead.phone}) após 15 dias sem resposta.`;
      await sendWhatsAppNotification(whatsappClient, message);
      await sendEmailNotification(gmailClient, 'Lead Descartado', message);
    }
  } catch (error) {
    console.error('Erro ao verificar leads descartados:', error);
  }
}

// Função para verificar interações pendentes em leads_esqueceram
async function checkPendingInteractions(whatsappClient, gmailClient) {
  try {
    const pending = await db.all(`
      SELECT c.phone, c.name, i.timestamp 
      FROM contacts c 
      JOIN interactions i ON c.id = i.contact_id 
      JOIN sales_funnel f ON c.id = f.contact_id 
      WHERE f.stage = 'leads_esqueceram' 
      AND i.timestamp < datetime('now', '-7 days')
    `);

    for (const lead of pending) {
      const message = `Atenção: ${lead.name} (${lead.phone}) está em "leads_esqueceram" há mais de 7 dias sem resposta.`;
      await sendWhatsAppNotification(whatsappClient, message);
      await sendEmailNotification(gmailClient, 'Interação Pendente', message);
    }
  } catch (error) {
    console.error('Erro ao verificar interações pendentes:', error);
  }
}

// Função principal para inicializar notificações automáticas
async function initializeNotifications(whatsappClient, gmailClient) {
  // Verificar a cada 15 minutos
  setInterval(async () => {
    await checkAppointments(whatsappClient, gmailClient);
    await checkDiscardedLeads(whatsappClient, gmailClient);
    await checkPendingInteractions(whatsappClient, gmailClient);
  }, 15 * 60 * 1000); // 15 minutos
  console.log('Notificações automáticas inicializadas!');
}

// Exportar função
module.exports = {
  initializeNotifications
};

// Teste (remova em produção)
if (require.main === module) {
  (async () => {
    const whatsappClient = await whatsapp.initializeWhatsApp();
    const gmailClient = await gmail.initializeGmail();
    await initializeNotifications(whatsappClient, gmailClient);
  })();
}