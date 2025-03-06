const gmail = require('@googleapis/gmail').gmail; // Importação direta do cliente Gmail
const fs = require('fs').promises;
const path = require('path');
const { authenticate } = require('@google-cloud/local-auth');

// Caminhos para os arquivos de credenciais e token
const CREDENTIALS_PATH = path.join(__dirname, '../credentials.json');
const TOKEN_PATH = path.join(__dirname, '../token.json');

// Escopos necessários para o Gmail
const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

// Função para carregar ou gerar o token de autenticação
async function authorize() {
  const credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH));
  const auth = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
    tokenPath: TOKEN_PATH,
  });
  return auth;
}

// Função para inicializar o cliente Gmail
async function initializeGmail() {
  const auth = await authorize();
  const gmailClient = gmail({ version: 'v1', auth }); // Criar o cliente Gmail
  console.log('Gmail autenticado com sucesso!');
  return gmailClient;
}

// Função para enviar e-mail
async function sendEmail(gmailClient, { to, subject, message }) {
  const raw = Buffer.from(
    `To: ${to}\r\nSubject: ${subject}\r\n\r\n${message}`
  ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

  try {
    const res = await gmailClient.users.messages.send({
      userId: 'me',
      requestBody: { raw },
    });
    console.log(`E-mail enviado para ${to}: ${subject}`);
    return res.data;
  } catch (error) {
    console.error('Erro ao enviar e-mail:', error);
    throw error;
  }
}

// Função para verificar novos e-mails
async function checkEmails(gmailClient, db) {
  try {
    const res = await gmailClient.users.messages.list({
      userId: 'me',
      q: 'in:inbox', // Apenas e-mails da caixa de entrada
      maxResults: 10, // Limite de e-mails a verificar
    });

    const messages = res.data.messages || [];
    for (const msg of messages) {
      const email = await gmailClient.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full',
      });

      const headers = email.data.payload.headers;
      const from = headers.find(h => h.name === 'From')?.value;
      const subject = headers.find(h => h.name === 'Subject')?.value || 'Sem assunto';
      const snippet = email.data.snippet;

      // Processar apenas e-mails não lidos
      if (!email.data.labelIds.includes('UNREAD')) continue;

      console.log(`[Gmail] E-mail recebido de ${from}: ${subject} - ${snippet}`);

      // Salvar no banco de dados
      const contact = await db.getContact({ email: from.split('<')[1]?.replace('>', '') || from });
      const contactId = contact ? contact.id : await db.upsertContact({
        name: from.split('<')[0].trim() || 'Desconhecido',
        email: from.split('<')[1]?.replace('>', '') || from,
        phone: null,
      });

      await db.logInteraction({
        contact_id: contactId,
        source: 'gmail',
        message: snippet,
        response: null, // Resposta será adicionada depois
      });

      // Marcar como lido
      await gmailClient.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] },
      });
    }
  } catch (error) {
    console.error('Erro ao verificar e-mails:', error);
  }
}

// Exportar funções
module.exports = {
  initializeGmail,
  sendEmail,
  checkEmails
};

// Teste (remova em produção)
if (require.main === module) {
  (async () => {
    const db = require('./database'); // Integração com o banco
    const gmailClient = await initializeGmail();
    await sendEmail(gmailClient, {
      to: 'l.gustavo2212@hotmail.com', // Substitua pelo seu e-mail de teste
      subject: 'Teste GhostEmpresarial',
      message: 'Este é um e-mail de teste!',
    });
    await checkEmails(gmailClient, db);
  })();
}