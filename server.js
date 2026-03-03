/**
 * arquivo: server.js
 * descrição: servidor backend do trocapreco
 * data: 29/01/2026
 */

const app = require("./src/app");
const http = require("http");
const { Server } = require("socket.io");

const port = process.env.PORT || 3000;

const server = http.createServer(app);

// Configuração do Socket.IO
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (origin.endsWith(".vercel.app")) return callback(null, true);
      if (origin.endsWith(".railway.app")) return callback(null, true);

      // Permitir qualquer IP da rede local 192.168.x.x
      if (origin && /^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) {
        return callback(null, true);
      }

      const allowed = [
        "http://localhost:4200",
        "http://localhost:8100",
        "http://192.168.100.12:4200",
        "https://trocaprecopub.vercel.app",
      ];
      callback(null, allowed.includes(origin));
    },
    methods: ["GET", "POST"],
  },
});

// Eventos do Socket.IO
io.on("connection", (socket) => {
  console.log("Cliente conectado:", socket.id);

  socket.on("usuarioApp", (data) => {
    console.log("usuarioApp:", data);
    socket.join(data.usuario);
  });

  socket.on("atualizacaoTarefas", (data) => {
    console.log("atualizacaoTarefas:", data);
    io.to(data.usuario).emit("atualizarTarefas");
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});

server.listen(port, () => {
  console.log("Backend TrocaPreco rodando na porta:", port);
  console.log("http://localhost:" + port);
});
