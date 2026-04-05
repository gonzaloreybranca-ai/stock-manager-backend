const express = require('express');
const axios = require('axios');
const cors = require('cors');
const redis = require('redis');

const app = express();
app.use(cors());
app.use(express.json());

const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI;

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
redisClient.connect().catch(console.error);

async function getToken() {
  return await redisClient.get('ml_access_token');
}

async function saveTokens(access, refresh) {
  await redisClient.set('ml_access_token', String(access));
  await redisClient.set('ml_refresh_token', String(refresh));
}

app.get('/auth/login', (req, res) => {
  const url = `https://auth.mercadolibre.com.ar/authorization?response_type=code&client_id=${ML_CLIENT_ID}&redirect_uri=${ML_REDIRECT_URI}`;
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const response = await axios.post('https://api.mercadolibre.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: ML_CLIENT_ID,
      client_secret: ML_CLIENT_SECRET,
      code,
      redirect_uri: ML_REDIRECT_URI
    });
    await saveTokens(response.data.access_token, response.data.refresh_token);
    res.send('<h2>Conectado con MercadoLibre. Ya podés cerrar esta pestaña.</h2>');
  } catch (err) {
    res.status(500).send('Error al obtener token: ' + err.message);
  }
});

app.get('/productos', async (req, res) => {
  try {
    const token = await getToken();
    if (!token) return res.status(401).json({ error: 'No autenticado. Visitá /auth/login primero.' });
    const me = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const userId = me.data.id;
    const items = await axios.get(`https://api.mercadolibre.com/users/${userId}/items/search?limit=50&status=active`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const ids = items.data.results;
    if (ids.length === 0) return res.json([]);
    const chunks = [];
    for (let i = 0; i < ids.length; i += 20) {
      chunks.push(ids.slice(i, i + 20));
    }
    let productos = [];
    for (const chunk of chunks) {
      const detalles = await axios.get(`https://api.mercadolibre.com/items?ids=${chunk.join(',')}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const parcial = detalles.data
        .filter(d => d.code === 200)
        .map(d => ({
          id: d.body.id,
          nombre: d.body.title,
          sku: d.body.seller_sku || '-',
          stockML: d.body.available_quantity,
          full: d.body.shipping?.logistic_type === 'fulfillment',
          precio: d.body.price,
          estado: d.body.status
        }));
      productos = productos.concat(parcial);
    }
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/productos/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;
  try {
    const token = await getToken();
    await axios.put(`https://api.mercadolibre.com/items/${id}`,
      { available_quantity: cantidad },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/status', async (req, res) => {
  const token = await getToken();
  res.json({ conectado: !!token });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
