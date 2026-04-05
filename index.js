const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const ML_CLIENT_ID = process.env.ML_CLIENT_ID;
const ML_CLIENT_SECRET = process.env.ML_CLIENT_SECRET;
const ML_REDIRECT_URI = process.env.ML_REDIRECT_URI;

let accessToken = null;
let refreshToken = null;

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
    accessToken = response.data.access_token;
    refreshToken = response.data.refresh_token;
    res.send('<h2>Conectado con MercadoLibre. Ya podés cerrar esta pestaña.</h2>');
  } catch (err) {
    res.status(500).send('Error al obtener token: ' + err.message);
  }
});

app.get('/productos', async (req, res) => {
  try {
    const me = await axios.get('https://api.mercadolibre.com/users/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const userId = me.data.id;
    const items = await axios.get(`https://api.mercadolibre.com/users/${userId}/items/search?limit=50`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const ids = items.data.results;
    if (ids.length === 0) return res.json([]);
    const detalles = await axios.get(`https://api.mercadolibre.com/items?ids=${ids.join(',')}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const productos = detalles.data.map(d => ({
      id: d.body.id,
      nombre: d.body.title,
      sku: d.body.seller_sku || '-',
      stockML: d.body.available_quantity,
      full: d.body.shipping?.logistic_type === 'fulfillment',
      precio: d.body.price,
      estado: d.body.status
    }));
    res.json(productos);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/productos/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { cantidad } = req.body;
  try {
    await axios.put(`https://api.mercadolibre.com/items/${id}`, 
      { available_quantity: cantidad },
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/status', (req, res) => {
  res.json({ conectado: !!accessToken });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
