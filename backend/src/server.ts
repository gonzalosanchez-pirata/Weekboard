import express from 'express';
import cors from 'cors';
import './database'; // Importa la configuración de la base de datos

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Endpoint de verificación de estado (Health check)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
