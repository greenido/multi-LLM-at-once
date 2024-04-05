/**
 * This is a simple Express server that serves a chat interface and interacts 
 * with the Claude AI API.
 * @author @greenido
 * @date 4-4-2024
 */
const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();
const port = 3000;

// Placeholder for the context
let context = '';

// Middleware for parsing request body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up a view engine
app.set('view engine', 'ejs');
// Set the views directory
app.set('views', path.join(__dirname, 'views'));

// Serve static files from the public directory
app.use(express.static('public'));

// Route for rendering the chat interface
app.get('/', (req, res) => {
  res.render('index', { context });
});

// Route for setting the context
app.post('/set-context', (req, res) => {
  context = req.body.context;
  console.log('== Got Context:', context);
  res.redirect('/');
});

// Route for handling user queries
app.post('/query', async (req, res) => {
  const query = req.body.query;
  console.log('== Got Query:', query);
  try {
    // Call the Claude AI API with the context and query
    const response = await axios.post('https://api.anthropic.com/v1/complete', {
      prompt: `${context}\nHuman: ${query}\nAssistant:`,
      max_tokens: 500,
      temperature: 0.7,
      stream: false,
      // Replace with your actual API key
      headers: { 'X-API-Key': process.env.CLAUDE_API_KEY },
    });

    const result = response.data.result;
    res.json({ result });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});