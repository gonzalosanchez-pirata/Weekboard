import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import './database';
import activitiesRouter from './routes/activities';
import cardsRouter from './routes/cards';
import weeksRouter from './routes/weeks';

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

// Orígenes permitidos: leídos desde ALLOWED_ORIGINS o defaults de desarrollo
const allowedOrigins: string[] = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5500', 'http://127.0.0.1:5500', 'http://localhost:3000'];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Permitir requests sin header Origin (Postman, curl, supertest, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origen no permitido: ${origin}`));
  },
  credentials: true,
};

// Middleware globales
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json());
app.use('/api', limiter);

// Registro de rutas
app.use('/api', activitiesRouter);
app.use('/api', cardsRouter);
app.use('/api', weeksRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Manejo global de errores (ej. CORS)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: 'Origen no permitido' });
  }
  res.status(500).json({ error: 'Error interno del servidor' });
});

export default app;