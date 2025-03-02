const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // For unique socket IDs
const winston = require("winston"); // For logging

// Configure Winston logger
const logger = winston.createLogger({
 level: "info",
 format: winston.format.combine(
 winston.format.timestamp(),
 winston.format.json()
 ),
 transports: [
 new winston.transports.File({ filename: "server.log" }),
 new winston.transports.Console()
 ],
});

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS for all routes
app.use(cors());

// Serve static files (optional - for future web interface)
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Create HTTP Server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Store active TV codes and PC connections
const activeTVs = {}; // { code: { socket, timestamp, pcConnection: null } }
const activePCs = {}; // { socketId: { socket, tvCode } }

const CODE_EXPIRY_TIME = 10 * 60 * 1000; // 10 minutes in milliseconds

// Function to generate a 6-digit code
function generateCode() {
 return Math.floor(100000 + Math.random() * 900000).toString();
}

// Helper function to notify a client with a message
function notifyClient(socket, type, message, extra = {}) {
 if (socket.readyState === WebSocket.OPEN) {
 socket.send(JSON.stringify({ type, message, ...extra }));
 } else {
 logger.warn(`Failed to send ${type} to client - socket not open`);
 }
}

// Function to cleanup expired codes
function cleanupExpiredCodes() {
 const now = Date.now();
 Object.keys(activeTVs).forEach(code => {
 if (now - activeTVs[code].timestamp > CODE_EXPIRY_TIME) {
 logger.info(`Code ${code} expired and removed`);

 // Notify TV if still connected
 notifyClient(
 activeTVs[code].socket,
 "code-expired",
 "Your pairing code has expired. Please refresh to generate a new code."
 );

 delete activeTVs[code];
 }
 });
}

// Run cleanup every minute
setInterval(cleanupExpiredCodes, 60 * 1000);

// WebSocket heartbeat to detect alive clients
function startHeartbeat() {
 setInterval(() => {
 wss.clients.forEach((client) => {
 if (!client.isAlive) {
 logger.warn(`Terminating unresponsive client: ${client.id}`);
 return client.terminate();
 }
 client.isAlive = false;
 client.ping();
 });
 }, 30000); // Ping every 30 seconds
}

// API Routes
app.get("/health", (req, res) => {
 res.json({ status: "ok", tvs: Object.keys(activeTVs).length, pcs: Object.keys(activePCs).length });
});

app.get("/check-pairing/:code", (req, res) => {
 const code = req.params.code;
 const isPaired = activeTVs[code] && activeTVs[code].pcConnection;
 res.json({ 
 paired: !!isPaired,
 active: !!activeTVs[code]
 });
});

app.get("/get-code", (req, res) => {
 // Find the most recent active code
 let activeCode = null;
 let latestTimestamp = 0;
 
 Object.keys(activeTVs).forEach(code => {
 if (activeTVs[code].timestamp > latestTimestamp) {
 latestTimestamp = activeTVs[code].timestamp;
 activeCode = code;
 }
 });
 
 if (activeCode) {
 return res.json({ code: activeCode });
 } else {
 return res.status(404).json({ error: "No active code available" });
 }
});

// WebSocket connection handler
wss.on("connection", (socket, req) => {
 socket.id = uuidv4(); // Assign unique ID to socket
 socket.isAlive = true; // For heartbeat
 logger.info(`New WebSocket client connected: ${socket.id}`);
 
 let clientType = null; // "tv" or "pc"
 let clientCode = null;

 // Heartbeat pong handler
 socket.on("pong", () => {
 socket.isAlive = true;
 });

 socket.on("message", (message) => {
 let data;
 try {
 data = JSON.parse(message.toString());
 if (!data.type) throw new Error("Message type is required");
 logger.info(`Received message type: ${data.type} from ${socket.id}`);
 } catch (err) {
 logger.error(`Invalid message format from ${socket.id}: ${err.message}`);
 notifyClient(socket, "error", "Invalid message format");
 return;
 }

 // Handle TV Registration
 if (data.type === "register-tv") {
 clientType = "tv";
 
 // Check for existing non-expired codes for this TV
 let existingCode = null;
 Object.keys(activeTVs).forEach(code => {
 if (activeTVs[code].socket === socket) {
 existingCode = code;
 }
 });
 
 if (existingCode && (Date.now() - activeTVs[existingCode].timestamp < CODE_EXPIRY_TIME)) {
 logger.info(`Returning existing code: ${existingCode} for ${socket.id}`);
 clientCode = existingCode;
 notifyClient(socket, "tv-registered", "TV registered", { code: existingCode });
 } else {
 // Generate a new code
 let newCode = generateCode();
 while (activeTVs[newCode]) {
 newCode = generateCode(); // Ensure uniqueness
 }
 
 clientCode = newCode;
 activeTVs[newCode] = { 
 socket, 
 timestamp: Date.now(),
 pcConnection: null
 };
 
 logger.info(`New TV registered with code: ${newCode} for ${socket.id}`);
 notifyClient(socket, "tv-registered", "TV registered", { code: newCode });
 }
 }

 // Handle PC Verification
 else if (data.type === "verify-code") {
 if (!data.code) {
 notifyClient(socket, "error", "Code is required");
 return;
 }
 clientType = "pc";
 const { code } = data;
 clientCode = code;

 if (activeTVs[code] && activeTVs[code].socket.readyState === WebSocket.OPEN) {
 logger.info(`Code verified: ${code} for PC ${socket.id}`);
 
 // Store PC connection
 activePCs[socket.id] = { socket, tvCode: code };
 activeTVs[code].pcConnection = socket;
 
 // Notify both parties
 notifyClient(socket, "code-verified", "Code verified. Ready to start casting.");
 notifyClient(activeTVs[code].socket, "pc-paired", "PC connected successfully!");
 } else {
 notifyClient(socket, "error", "Invalid or expired code");
 }
 }

 // Handle WebRTC Offer (PC → TV)
 else if (data.type === "screen-cast-offer") {
 if (clientType !== "pc" || !clientCode || !activeTVs[clientCode] || !data.offer) {
 notifyClient(socket, "error", "Invalid screen-cast-offer");
 return;
 }
 logger.info(`Relaying WebRTC offer from PC ${socket.id} to TV ${clientCode}`);
 notifyClient(activeTVs[clientCode].socket, "offer", "WebRTC offer received", { offer: data.offer });
 }

 // Handle WebRTC Answer (TV → PC)
 else if (data.type === "screen-cast-answer") {
 if (clientType !== "tv" || !clientCode || !activeTVs[clientCode]?.pcConnection || !data.answer) {
 notifyClient(socket, "error", "Invalid screen-cast-answer");
 return;
 }
 logger.info (`Relaying WebRTC answer from TV ${clientCode} to PC`);
 notifyClient(activeTVs[clientCode].pcConnection, "answer", "WebRTC answer received", { answer: data.answer });
 }

 // Handle ICE Candidates
 else if (data.type === "ice-candidate") {
 if (!data.candidate) {
 notifyClient(socket, "error", "ICE candidate is required");
 return;
 }
 if (clientType === "pc" && clientCode && activeTVs[clientCode]) {
 logger.info(`Relaying ICE candidate from PC ${socket.id} to TV ${clientCode}`);
 notifyClient(activeTVs[clientCode].socket, "ice-candidate", "ICE candidate received", { candidate: data.candidate });
 } 
 else if (clientType === "tv" && clientCode && activeTVs[clientCode]?.pcConnection) {
 logger.info(`Relaying ICE candidate from TV ${clientCode} to PC`);
 notifyClient(activeTVs[clientCode].pcConnection, "ice-candidate", "ICE candidate received", { candidate: data.candidate });
 }
 }
 
 // Handle Stop Screen Cast
 else if (data.type === "stop-screen-cast") {
 if (clientType !== "pc" || !clientCode || !activeTVs[clientCode]) {
 notifyClient(socket, "error", "Invalid stop-screen-cast request");
 return;
 }
 logger.info(`Relaying stop screen cast from PC ${socket.id} to TV ${clientCode}`);
 
 notifyClient(activeTVs[clientCode].socket, "stop-screen-cast", "PC initiated disconnect", {
 action: "disconnect",
 timestamp: data.timestamp || Date.now(),
 reason: "PC initiated disconnect"
 });
 
 notifyClient(socket, "cast-stopped-ack", "Screen cast stopped", { timestamp: Date.now() });
 logger.info(`Screen cast stopped for code ${clientCode}, but pairing remains active`);
 }
 
 // Handle explicit casting session end (complete disconnect)
 else if (data.type === "end-casting-session") {
 if (clientType !== "pc" || !clientCode || !activeTVs[clientCode]) {
 notifyClient(socket, "error", "Invalid end-casting-session request");
 return;
 }
 logger.info(`Ending complete casting session for ${clientCode}`);
 
 notifyClient(activeTVs[clientCode].socket, "session-ended", "Casting session ended. Return to pairing screen.");
 activeTVs[clientCode].pcConnection = null;
 notifyClient(socket, "session-ended-ack", "Session ended successfully");
 }

 // Handle TV-initiated streaming end request
 else if (data.type === "end-streaming-request") {
 if (clientType !== "tv" || !clientCode || !activeTVs[clientCode]?.pcConnection) {
 notifyClient(socket, "error", "Invalid end-streaming-request");
 return;
 }
 logger.info(`TV ${clientCode} requested to end streaming`);
 
 notifyClient(activeTVs[clientCode].pcConnection, "end-streaming-request", "TV requested to end streaming", {
 timestamp: data.timestamp || Date.now()
 });
 notifyClient(socket, "end-streaming-request-ack", "End streaming request sent", { timestamp: Date.now() });
 }
 
 // Handle TV ready signal
 else if (data.type === "tv-ready-for-new-connection") {
 if (clientType !== "tv" || !clientCode) {
 notifyClient(socket, "error", "Invalid tv-ready-for-new-connection request");
 return;
 }
 logger.info(`TV with code ${clientCode} is ready for a new connection`);
 if (activeTVs[clientCode]) {
 activeTVs[clientCode].pcConnection = null;
 }
 }
 });

 // Handle disconnection
 socket.on("close", () => {
 if (clientType === "tv" && clientCode) {
 logger.info(`TV with code ${clientCode} disconnected`);
 
 if (activeTVs[clientCode]?.pcConnection) {
 notifyClient(activeTVs[clientCode].pcConnection, "tv-disconnected", "TV has disconnected");
 }
 delete activeTVs[clientCode];
 } 
 else if (clientType === "pc") {
 logger.info(`PC ${socket.id} disconnected`);
 
 if (clientCode && activeTVs[clientCode]) {
 notifyClient(activeTVs[clientCode].socket, "pc-disconnected", "PC has disconnected", {
 action: "return-to-pairing",
 shouldResetPlayer: true
 });
 activeTVs[clientCode].pcConnection = null;
 }
 delete activePCs[socket.id];
 }
 });

 // Send initial connection acknowledgment
 notifyClient(socket, "connected", "Connected to WebScreen Caster server");
});

// Graceful shutdown handler
function shutDown() {
 logger.info("Shutting down server...");
 wss.clients.forEach((client) => {
 if (client.readyState === WebSocket.OPEN) {
 notifyClient(client, "server-shutdown", "Server is shutting down");
 client.close();
 }
 });
 server.close(() => {
 logger.info("Server closed");
 process.exit(0);
 });
}

process.on("SIGTERM", shutDown);
process.on("SIGINT", shutDown);

// Start the server
server.listen(PORT, () => {
 startHeartbeat(); // Start WebSocket heartbeat
 logger.info(`WebScreen Caster server running on port ${PORT}`);
 logger.info("WebSocket server is active");
});