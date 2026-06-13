import app from './server';

// Configuración inicial del puerto
const PORT = process.env.PORT || 3000;

// Inicio del servidor
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});