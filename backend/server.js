const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("Conectado ao MongoDB"))
  .catch(err => console.log(err));

const UserSchema = new mongoose.Schema({
  nome: String,
  email: { type: String, unique: true },
  senha: { type: String },
  role: { type: String, default: 'participante' }
});

const ChampionshipSchema = new mongoose.Schema({
  nome: String,
  formato: String,
  qtd_times: Number,
  criador: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  times: Array,
  partidas: Array
});

const User = mongoose.model('User', UserSchema);
const Championship = mongoose.model('Championship', ChampionshipSchema);

app.post('/register', async (req, res) => {
  const { nome, email, senha } = req.body;
  const hashedSenha = await bcrypt.hash(senha, 10);
  try {
    const user = await User.create({ nome, email, senha: hashedSenha });
    res.status(201).json(user);
  } catch (e) { res.status(400).send("Erro ao registrar"); }
});


// Rota para Listar todos os Campeonatos
app.get('/championships', async (req, res) => {
  try {
    const campeonatos = await Championship.find();
    res.json(campeonatos);
  } catch (erro) {
    res.status(500).send("Erro ao buscar campeonatos");
  }
});

app.listen(5000, () => console.log("Servidor rodando na porta 5000"));
