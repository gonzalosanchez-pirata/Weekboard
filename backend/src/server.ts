import express from 'express';
import cors from 'cors';
import './database';
import activitiesRouter from './routes/activities';
import cardsRouter from './routes/cards';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', activitiesRouter);
app.use('/api', cardsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;