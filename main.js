const { app, BrowserWindow, ipcMain } = require('electron');
const { fork } = require('child_process');
const path = require('path');

let funnelProcess;

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

  // Receber mensagens do processo filho
  funnelProcess.on('message', (msg) => {
    console.log('[Funnel Process]:', msg);
    win.webContents.send('funnel-update', msg); // Enviar atualizações para a interface
  });

  // Tratar saída do processo
  funnelProcess.on('exit', (code) => {
    console.log(`Funnel process exited with code ${code}`);
  });

  return win;
}

app.whenReady().then(() => {
  const win = createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Configurar IPC para comunicação com a interface
  ipcMain.on('move-lead', (event, { contactId, stage }) => {
    funnelProcess.send({ action: 'moveLead', contactId, stage });
  });

  ipcMain.on('load-leads', async (event) => {
    funnelProcess.send({ action: 'loadLeads' });
  });

  ipcMain.on('load-appointments', async (event) => {
    funnelProcess.send({ action: 'loadAppointments' });
  });
});

app.on('window-all-closed', () => {
  if (funnelProcess) funnelProcess.kill(); // Encerrar o processo filho
  if (process.platform !== 'darwin') app.quit();
});