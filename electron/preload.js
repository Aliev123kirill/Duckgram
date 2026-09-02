const {contextBridge, ipcRenderer} = require('electron');

const OVERLAY_SIZE = 128;
const BADGE_RADIUS = 44;
const BADGE_MARGIN = 6;

function drawOverlayDataURL(count) {
  const canvas = document.createElement('canvas');
  canvas.width = OVERLAY_SIZE;
  canvas.height = OVERLAY_SIZE;
  const ctx = canvas.getContext('2d');
  if(!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, OVERLAY_SIZE, OVERLAY_SIZE);

  ctx.beginPath();
  ctx.arc(
    OVERLAY_SIZE - BADGE_RADIUS - BADGE_MARGIN,
    OVERLAY_SIZE - BADGE_RADIUS - BADGE_MARGIN,
    BADGE_RADIUS,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = '#e53935';
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  const text = count > 99 ? '99+' : String(count);
  let fontSize = 64;
  if(text.length >= 3) {
    fontSize = 40;
  } else if(text.length === 2) {
    fontSize = 52;
  }
  ctx.font = `bold ${fontSize}px "Segoe UI", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, OVERLAY_SIZE / 2, OVERLAY_SIZE / 2 + fontSize * 0.05);

  return canvas.toDataURL('image/png');
}

let lastBadgeCount = 0;

contextBridge.exposeInMainWorld('electronHelpers', {
  isElectron: true,
  openExternal: (url) => {
    if(typeof url === 'string') {
      ipcRenderer.invoke('open-external', url);
    }
  },
  setBadgeCount: (count) => {
    count = Math.max(0, +count || 0);
    if(count === lastBadgeCount) {
      return;
    }
    lastBadgeCount = count;
    const dataURL = count > 0 ? drawOverlayDataURL(count) : null;
    ipcRenderer.send('set-badge', dataURL);
  },
  setNotificationSoundState: (enabled) => {
    ipcRenderer.send('set-notification-sound-state', !!enabled);
  },
  onSetNotificationSound: (callback) => {
    const listener = (_event, enabled) => callback(!!enabled);
    ipcRenderer.on('set-notification-sound', listener);
    return () => {
      ipcRenderer.removeListener('set-notification-sound', listener);
    };
  }
});
