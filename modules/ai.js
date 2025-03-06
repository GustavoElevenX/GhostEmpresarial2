require('dotenv').config();
const axios = require('axios');
const path = require('path');

// Configuração da API do OpenRouter
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Verificação da chave com log
console.log('Carregando OPENROUTER_API_KEY:', OPENROUTER_API_KEY ? 'Chave encontrada' : 'Chave não encontrada');
console.log('Primeiros 5 caracteres da chave (para debug):', OPENROUTER_API_KEY ? OPENROUTER_API_KEY.slice(0, 5) + '...' : 'Nenhuma');

if (!OPENROUTER_API_KEY) {
  throw new Error('OPENROUTER_API_KEY não está definida no arquivo .env ou está vazia');
}

// Armazenar histórico básico por número de WhatsApp
const conversationHistory = new Map();

async function processMessage(whatsappNumber, message) {
  try {
    let history = conversationHistory.get(whatsappNumber) || [];
    history.push({ role: 'user', content: message });

    const requestBody = {
      model: 'deepseek/deepseek-chat:free',
      messages: [
        { 
          role: 'system', 
          content: 'Você é uma IA empresarial objetiva e persuasiva, focada em converter leads para vendas rapidamente. No primeiro contato, engaje o cliente com uma abordagem curta e cativante, perguntando sobre o negócio ou necessidades sem oferecer reuniões diretamente. Depois, use o histórico para evitar repetições e guie o lead para agendar uma reunião ou tomar uma ação concreta, com respostas curtas, diretas e sempre com um call-to-action claro. Não ensine ou dê dicas longas, foque em fechar o próximo passo.' 
        },
        ...history
      ],
      max_tokens: 100,
      temperature: 0.7
    };

    const headers = {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json'
    };

    console.log('Enviando requisição para OpenRouter com headers:', {
      'Authorization': `Bearer ${OPENROUTER_API_KEY.slice(0, 5)}...`,
      'Content-Type': 'application/json'
    });

    const response = await axios.post(OPENROUTER_API_URL, requestBody, { headers });

    let aiResponse = response.data.choices[0].message.content;
    aiResponse = aiResponse.replace(/<｜end▁of▁sentence｜>/g, '').trim();
    history.push({ role: 'assistant', content: aiResponse });
    conversationHistory.set(whatsappNumber, history.slice(-4));

    return aiResponse;
  } catch (error) {
    console.error('Erro ao processar mensagem com a IA:', error.response ? error.response.data : error.message);
    return 'Desculpe, ocorreu um erro ao processar sua mensagem.';
  }
}

async function handleInteraction(whatsappNumber, inputMessage, source) {
  console.log(`[${source}] Recebido: ${inputMessage}`);
  const reply = await processMessage(whatsappNumber, inputMessage);
  console.log(`[${source}] Resposta: ${reply}`);
  return reply;
}

module.exports = {
  processMessage,
  handleInteraction
};

if (require.main === module) {
  (async () => {
    const testMessage = 'Como posso agendar uma reunião?';
    const reply = await handleInteraction('test-number', testMessage, 'Teste');
    console.log('Teste concluído:', reply);
  })();
}