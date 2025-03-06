const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

// Variável global para armazenar o client
let client;

function initializeWhatsApp(customOptions = {}) {
  const defaultOptions = {
    authStrategy: new LocalAuth(),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
    }
  };
  client = new Client({ ...defaultOptions, ...customOptions });

  client.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo com o WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', () => {
    console.log('WhatsApp conectado com sucesso!');
    if (process.send) process.send({ type: 'whatsappConnected' });
  });

  client.on('message', (message) => {
    console.log(`[WhatsApp] Mensagem recebida de ${message.from}: ${message.body}`);
  });

  client.on('auth_failure', (msg) => {
    console.error('Falha na autenticação do WhatsApp:', msg);
  });

  client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado:', reason);
  });

  return client.initialize().then(() => client).catch((error) => {
    throw error;
  });
}

async function sendMessage(to, text) {
  try {
    if (!client) throw new Error('WhatsApp client não inicializado');
    await client.sendMessage(to, text);
    console.log(`[WhatsApp] Mensagem enviada para ${to}: ${text}`);
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    throw error;
  }
}

module.exports = {
  initializeWhatsApp,
  sendMessage,
  client // Exportado para debug, se necessário
};

if (require.main === module) {
  initializeWhatsApp();
}