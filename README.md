# 📺 LG TV Remote — WiFi Control App

Control your LG Smart TV from any browser on the same WiFi network.

## Requirements
- Node.js v16+ installed on your computer
- LG Smart TV (WebOS 2.0+) on the same WiFi network
- A phone/tablet/computer browser to use as the remote

---

## Setup (First Time)

```bash
# 1. Go into the project folder
cd lg-remote

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

Open your browser at: **http://localhost:3001**

---

## How to Use

1. **Find your TV's IP address**
   - On your LG TV: Settings → Network → Wi-Fi Connection → Advanced Settings
   - OR click the **Scan** button in the app to auto-discover

2. **Enter the TV IP** in the input box and click **Connect**

3. **Accept the pairing request** that appears on your TV screen
   - This only happens ONCE — the key is saved in `tv-key.json`

4. **Control your TV!**

---

## Use from Any Device on WiFi

Find your computer's local IP address:
- **Windows**: Run `ipconfig` in CMD → look for IPv4 Address
- **Mac/Linux**: Run `ifconfig` or `ip addr`

Then open on phone/tablet: `http://192.168.x.x:3001`

---

## Controls Available

| Section        | Controls                                      |
|----------------|-----------------------------------------------|
| Power          | Power Off                                     |
| System         | Home, Back, Menu, Info, Exit                  |
| Volume         | Up, Down, Mute                                |
| Channel        | Up, Down                                      |
| Navigation     | D-Pad (Up/Down/Left/Right), OK                |
| Media          | Play, Pause, Stop, Rewind, Fast Forward       |
| Colour Buttons | Red, Green, Yellow, Blue                      |
| Apps           | Netflix, YouTube, Prime, Disney+, Hotstar...  |
| Inputs         | Switch between HDMI/AV inputs                 |

---

## REST API Reference

All endpoints return JSON. Base URL: `http://localhost:3001`

```
POST /api/connect          body: { ip: "192.168.1.10" }
POST /api/disconnect
GET  /api/status

POST /api/power/off
POST /api/volume/up
POST /api/volume/down
POST /api/volume/mute
POST /api/volume/set       body: { volume: 15 }
GET  /api/volume

POST /api/channel/up
POST /api/channel/down
GET  /api/channels

POST /api/button/:name     name: up|down|left|right|ok|back|home|menu|info|red|green|yellow|blue|play|pause|stop|rewind|forward|exit

GET  /api/inputs
POST /api/input/switch     body: { inputId: "HDMI_1" }

GET  /api/apps
GET  /api/apps/common
POST /api/app/launch       body: { appId: "netflix" }

POST /api/media/play
POST /api/media/pause
POST /api/media/stop

GET  /api/tv/info
GET  /api/tv/current-app
GET  /api/discover
```

---

## Troubleshooting

**"Connection timeout"**
- Make sure your TV is ON and connected to WiFi
- Double-check the IP address
- Ensure your computer and TV are on the SAME WiFi network

**"TV shows pairing prompt but nothing happens"**
- Click Allow/Yes on your TV when it asks

**TV turns off but other commands don't work**
- Some TVs need to be turned on first with the physical remote
- Power ON via Wake-on-LAN (WoL) can be added if needed

---

## Tech Stack
- **Backend**: Node.js + Express + WebSocket
- **TV Protocol**: LG WebOS SSAP (Simple Service Access Protocol) over WebSocket port 3000
- **Discovery**: SSDP (Simple Service Discovery Protocol)
- **Frontend**: Vanilla HTML/CSS/JS (no framework needed)
