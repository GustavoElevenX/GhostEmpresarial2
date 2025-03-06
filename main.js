const { app, BrowserWindow, ipcMain } = require('electron');
const { fork } = require('child_process');
const path = require('path');

let funnelProcess;
let mainWindow;

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile('index.html');
  win.webContents.openDevTools();

  // Iniciar o processo do funnel.js
  funnelProcess = fork(path.join(__dirname, 'modules', 'funnel.js'));

  // Variável para rastrear se o funil está pronto
  let funnelReady = false;

  // Receber mensagens do processo filho
  funnelProcess.on('message', (msg) => {
    console.log('[Funnel Process]:', msg);
    if (msg.type === 'funnelReady') {
      funnelReady = true;
      console.log('Funil pronto, enviando solicitações iniciais...');
      // Enviar solicitações iniciais apenas quando o funil estiver pronto
      funnelProcess.send({ action: 'loadLeads' });
      funnelProcess.send({ action: 'loadAppointments' });
    }
    win.webContents.send('funnel-update', msg); // Enviar atualizações para a interface
  });

  // Tratar saída do processo
  funnelProcess.on('exit', (code) => {
    console.log(`Funnel process exited with code ${code}`);
  });

  // Configurar IPC para comunicação com a interface
  ipcMain.on('move-lead', (event, { contactId, stage }) => {
    if (funnelReady) {
      funnelProcess.send({ action: 'moveLead', contactId, stage });
    } else {
      console.log('Aguardando inicialização do funil para mover lead...');
      event.reply('funnel-error', 'Funil ainda não inicializado');
    }
  });

  ipcMain.on('load-leads', (event) => {
    if (funnelReady) {
      funnelProcess.send({ action: 'loadLeads' });
    } else {
      console.log('Aguardando inicialização do funil para carregar leads...');
      event.reply('funnel-error', 'Funil ainda não inicializado');
    }
  });

  ipcMain.on('load-appointments', (event) => {
    if (funnelReady) {
      funnelProcess.send({ action: 'loadAppointments' });
    } else {
      console.log('Aguardando inicialização do funil para carregar appointments...');
      event.reply('funnel-error', 'Funil ainda não inicializado');
    }
  });

  mainWindow = win;
  return win;
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (funnelProcess) funnelProcess.kill(); // Encerrar o processo filho
  if (process.platform !== 'darwin') app.quit();
});