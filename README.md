# WebScreen Caster

A WebRTC-based screen casting solution that allows you to cast your PC screen to a TV/display device through a simple pairing code system.

## 🚀 Features

- **Simple Pairing System**: Connect devices using a 6-digit code
- **WebRTC Technology**: Low-latency, high-quality screen sharing
- **No App Installation**: Works directly in compatible browsers
- **Secure Connection**: Direct peer-to-peer communication after initial pairing
- **Connection Management**: Automatic cleanup of expired sessions
- **Heartbeat Mechanism**: Ensures reliable connections
- **Health Monitoring**: API endpoint to check server status

## 📋 Prerequisites

- Node.js (v12.0.0 or higher recommended)
- npm or yarn

## 🔧 Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/surajsh25/WebScreenCast-Server.git
   cd webscreen-caster
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the server:
   ```bash
   npm start
   ```

The server will start on port 3000 by default. You can modify the port by setting the `PORT` environment variable.

## 💻 Usage

### TV/Display Device:
1. Open the web client on your TV or display device
2. The device will automatically register and display a 6-digit pairing code
3. This code remains active for 10 minutes

### PC/Source Device:
1. Open the web client on your PC
2. Enter the pairing code displayed on your TV
3. Once connected, you can start casting your screen
4. Use the controls to stop or pause casting as needed

## 🔌 API Endpoints

- `GET /health` - Check server status and get active connection counts
- `GET /check-pairing/:code` - Check if a pairing code is active and connected
- `GET /get-code` - Get the most recently generated active code

## 📡 WebSocket Protocol

### Message Types:

#### TV Device:
- `register-tv` - Register a new TV and get a pairing code
- `screen-cast-answer` - Send WebRTC answer to PC
- `ice-candidate` - Exchange ICE candidates
- `end-streaming-request` - Request PC to stop streaming
- `tv-ready-for-new-connection` - Signal TV is ready for a new connection

#### PC Device:
- `verify-code` - Verify a pairing code to connect to a TV
- `screen-cast-offer` - Send WebRTC offer to TV
- `ice-candidate` - Exchange ICE candidates
- `stop-screen-cast` - Temporarily stop screen cast
- `end-casting-session` - Completely end the casting session

## 📝 Logging

The server uses Winston for logging. Logs are stored in:
- Console output
- `server.log` file

## 🛠️ Dependencies

- express - Web server framework
- ws - WebSocket implementation
- uuid - For generating unique socket IDs
- winston - For logging
- cors - For cross-origin resource sharing
- http - Node.js HTTP server

## 🔒 Security Considerations

- Pairing codes expire after 10 minutes
- WebRTC connections are direct peer-to-peer
- The server only facilitates initial connection and signaling

## 🛡️ Error Handling

The server provides descriptive error messages for:
- Invalid message formats
- Missing required parameters
- Expired or invalid pairing codes
- Connection failures

## 🐛 Troubleshooting

If you encounter issues:
1. Check the server logs
2. Ensure both devices are on the same network
3. Verify your browser supports WebRTC
4. Check your firewall settings

## 📊 Future Enhancements

- Web interface for server monitoring
- Multiple simultaneous connections per TV
- Screen recording capability
- Mobile device support

## 👨‍💻 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
