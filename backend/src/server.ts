import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import './database';
import activitiesRouter from './routes/activities';
import cardsRouter from './routes/cards';

const app = express();

const isDev = process.env.NODE_ENV !== 'production';

// Configuración de rate limiting
const limiter = rateLimit({
  windowMs: isDev ? 60 * 1000 : 15 * 60 * 1000,
  max: isDev ? 500 : 100,
  message: { error: 'Demasiadas peticiones. Intentá de nuevo en unos minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware globales
app.use(cors());
app.use(express.json());
app.use('/api', limiter);

// Registro de rutas
app.use('/api', activitiesRouter);
app.use('/api', cardsRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;