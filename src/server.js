const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const lgtv2 = require('lgtv2');
const { Client: SsdpClient } = require('node-ssdp');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// ─────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────
let tvConnection = null;
let tvConnected = false;
let currentTvIp = null;
let clientSockets = new Set(); // browser WebSocket clients

// ─────────────────────────────────────────────
// BROADCAST to all browser clients
// ─────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  clientSockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ─────────────────────────────────────────────
// CONNECT TO LG TV
// ─────────────────────────────────────────────
function connectToTV(ip) {
  return new Promise((resolve, reject) => {
    if (tvConnection) {
      try { tvConnection.disconnect(); } catch(e) {}
      tvConnection = null;
      tvConnected = false;
    }

    currentTvIp = ip;
    const wsUrl = `ws://${ip}:3000`;

    console.log(`[TV] Connecting to ${wsUrl}...`);
    broadcast({ type: 'status', status: 'connecting', ip });

    const tv = lgtv2({
      url: wsUrl,
      timeout: 10000,
      reconnect: 3000,
      // Key file stores pairing key so you only pair once
      keyFile: path.join(__dirname, '../tv-key.json')
    });

    tv.on('connect', () => {
      console.log('[TV] Connected!');
      tvConnection = tv;
      tvConnected = true;
      broadcast({ type: 'status', status: 'connected', ip });
      resolve(tv);
    });

    tv.on('connecting', (host) => {
      console.log(`[TV] Connecting to ${host}...`);
    });

    tv.on('close', () => {
      console.log('[TV] Disconnected');
      tvConnected = false;
      broadcast({ type: 'status', status: 'disconnected' });
    });

    tv.on('error', (err) => {
      console.error('[TV] Error:', err.message);
      tvConnected = false;
      broadcast({ type: 'status', status: 'error', message: err.message });
      reject(err);
    });

    // Timeout if no connect in 15s
    setTimeout(() => {
      if (!tvConnected) reject(new Error('Connection timeout - check TV IP and that TV is on'));
    }, 15000);
  });
}

// ─────────────────────────────────────────────
// SEND COMMAND TO TV
// ─────────────────────────────────────────────
function sendCommand(uri, payload = null) {
  return new Promise((resolve, reject) => {
    if (!tvConnection || !tvConnected) {
      return reject(new Error('Not connected to TV'));
    }
    const cb = (err, res) => {
      if (err) return reject(err);
      resolve(res);
    };
    if (payload) {
      tvConnection.request(uri, payload, cb);
    } else {
      tvConnection.request(uri, cb);
    }
  });
}

// Send a button via SSAP remote input
function sendButton(button) {
  return new Promise((resolve, reject) => {
    if (!tvConnection || !tvConnected) {
      return reject(new Error('Not connected to TV'));
    }
    tvConnection.getSocket('ssap://com.webos.service.networkinput/getPointerInputSocket', (err, sock) => {
      if (err) return reject(err);
      sock.send('button', { name: button });
      resolve({ ok: true });
    });
  });
}

// ─────────────────────────────────────────────
// TV DISCOVERY (SSDP)
// ─────────────────────────────────────────────
function discoverTVs() {
  return new Promise((resolve) => {
    const found = [];
    const client = new SsdpClient();

    client.on('response', (headers, statusCode, rinfo) => {
      const ip = rinfo.address;
      if (!found.find(d => d.ip === ip)) {
        const device = {
          ip,
          server: headers.SERVER || 'Unknown',
          location: headers.LOCATION || ''
        };
        found.push(device);
        console.log('[Discovery] Found device:', ip);
        broadcast({ type: 'discovery', device });
      }
    });

    // Search for LG TV specific service
    client.search('urn:lge-com:service:webos-second-screen:1');
    // Also search for all media renderers
    setTimeout(() => client.search('ssdp:all'), 500);

    setTimeout(() => {
      client.stop();
      resolve(found);
    }, 5000);
  });
}

// ─────────────────────────────────────────────
// REST API ROUTES
// ─────────────────────────────────────────────

// Status
app.get('/api/status', (req, res) => {
  res.json({
    connected: tvConnected,
    ip: currentTvIp
  });
});

// Connect to TV
app.post('/api/connect', async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP address required' });
  try {
    await connectToTV(ip);
    res.json({ ok: true, message: 'Connected to TV' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Disconnect
app.post('/api/disconnect', (req, res) => {
  if (tvConnection) {
    tvConnection.disconnect();
    tvConnection = null;
    tvConnected = false;
    currentTvIp = null;
  }
  res.json({ ok: true });
});

// Discover TVs on network
app.get('/api/discover', async (req, res) => {
  broadcast({ type: 'discovery_start' });
  const devices = await discoverTVs();
  res.json({ devices });
});

// ── POWER ──
app.post('/api/power/off', async (req, res) => {
  try {
    await sendCommand('ssap://system/turnOff');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── VOLUME ──
app.post('/api/volume/up', async (req, res) => {
  try {
    await sendCommand('ssap://audio/volumeUp');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/volume/down', async (req, res) => {
  try {
    await sendCommand('ssap://audio/volumeDown');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/volume/mute', async (req, res) => {
  try {
    // Toggle mute
    const status = await sendCommand('ssap://audio/getStatus');
    await sendCommand('ssap://audio/setMute', { mute: !status.mute });
    res.json({ ok: true, muted: !status.mute });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/volume/set', async (req, res) => {
  const { volume } = req.body;
  try {
    await sendCommand('ssap://audio/setVolume', { volume: parseInt(volume) });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/volume', async (req, res) => {
  try {
    const status = await sendCommand('ssap://audio/getStatus');
    res.json(status);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CHANNELS ──
app.post('/api/channel/up', async (req, res) => {
  try {
    await sendCommand('ssap://tv/channelUp');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/channel/down', async (req, res) => {
  try {
    await sendCommand('ssap://tv/channelDown');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/channels', async (req, res) => {
  try {
    const result = await sendCommand('ssap://tv/getChannelList');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── NAVIGATION BUTTONS ──
const BUTTON_MAP = {
  up:       'UP',
  down:     'DOWN',
  left:     'LEFT',
  right:    'RIGHT',
  ok:       'ENTER',
  back:     'BACK',
  home:     'HOME',
  menu:     'MENU',
  info:     'INFO',
  red:      'RED',
  green:    'GREEN',
  yellow:   'YELLOW',
  blue:     'BLUE',
  play:     'PLAY',
  pause:    'PAUSE',
  stop:     'STOP',
  rewind:   'REWIND',
  forward:  'FASTFORWARD',
  exit:     'EXIT'
};

app.post('/api/button/:name', async (req, res) => {
  const btnName = req.params.name.toLowerCase();
  const lgButton = BUTTON_MAP[btnName];
  if (!lgButton) return res.status(400).json({ error: `Unknown button: ${btnName}` });
  try {
    await sendButton(lgButton);
    res.json({ ok: true, button: lgButton });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── INPUTS ──
app.get('/api/inputs', async (req, res) => {
  try {
    const result = await sendCommand('ssap://tv/getExternalInputList');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/input/switch', async (req, res) => {
  const { inputId } = req.body;
  try {
    await sendCommand('ssap://tv/switchInput', { inputId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── APPS ──
app.get('/api/apps', async (req, res) => {
  try {
    const result = await sendCommand('ssap://com.webos.applicationManager/listApps');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/app/launch', async (req, res) => {
  const { appId } = req.body;
  try {
    await sendCommand('ssap://system.launcher/launch', { id: appId });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Common app IDs for LG WebOS
app.get('/api/apps/common', (req, res) => {
  res.json([
    { id: 'netflix',                    name: 'Netflix',   icon: '🎬' },
    { id: 'youtube.leanback.v4',        name: 'YouTube',   icon: '▶️' },
    { id: 'amazon',                     name: 'Prime',     icon: '📦' },
    { id: 'com.disney.disneyplus-prod', name: 'Disney+',  icon: '✨' },
    { id: 'com.apple.appletv',          name: 'Apple TV',  icon: '🍎' },
    { id: 'hotstar',                    name: 'Hotstar',   icon: '⭐' },
    { id: 'com.spotify.spotify',        name: 'Spotify',   icon: '🎵' },
    { id: 'com.webos.app.browser',      name: 'Browser',   icon: '🌐' }
  ]);
});

// ── MEDIA CONTROLS (for content playing) ──
app.post('/api/media/play', async (req, res) => {
  try {
    await sendCommand('ssap://media.controls/play');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/media/pause', async (req, res) => {
  try {
    await sendCommand('ssap://media.controls/pause');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/media/stop', async (req, res) => {
  try {
    await sendCommand('ssap://media.controls/stop');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TV INFO ──
app.get('/api/tv/info', async (req, res) => {
  try {
    const info = await sendCommand('ssap://system/getSystemInfo');
    res.json(info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/tv/current-app', async (req, res) => {
  try {
    const result = await sendCommand('ssap://com.webos.applicationManager/getForegroundAppInfo');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────
// BROWSER WEBSOCKET (for real-time status)
// ─────────────────────────────────────────────
wss.on('connection', (ws) => {
  clientSockets.add(ws);
  console.log('[WS] Browser client connected');

  // Send current status on connect
  ws.send(JSON.stringify({
    type: 'status',
    status: tvConnected ? 'connected' : 'disconnected',
    ip: currentTvIp
  }));

  ws.on('close', () => {
    clientSockets.delete(ws);
    console.log('[WS] Browser client disconnected');
  });
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║     LG TV Remote - Backend Server    ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  Web Remote:  http://localhost:${PORT}`);
  console.log(`  On network:  http://<YOUR_IP>:${PORT}`);
  console.log('');
  console.log('  Steps:');
  console.log('  1. Open the URL above in your browser');
  console.log('  2. Enter your LG TV IP address');
  console.log('  3. Accept the pairing prompt on your TV');
  console.log('  4. Done! Control your TV remotely.');
  console.log('');
});
