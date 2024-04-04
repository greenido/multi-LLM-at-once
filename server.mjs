import { Ollama } from "@langchain/community/llms/ollama";

import express from 'express';
//import axios from ('axios');
const app = express();
const port = 3000;

// Placeholder for the context
let context = '';

// Middleware for parsing request body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Set up a view engine
app.set('view engine', 'ejs');

// Serve static files from the public directory
app.use(express.static('public'));

// Route for rendering the chat interface
app.get('/', (req, res) => {
  console.log('=**= Rendering index with context:', context);
  res.render('index', { context });
});

app.get('/index-boot4', (req, res) => {
  console.log('=**= Rendering index with context:', context);
  res.render('index-boot4', { context });
});
// Route for setting the context
app.post('/set-context', (req, res) => {
  context = req.body.context;
  console.log('== Got Context:', context);
  res.redirect('/');
});

// Route for handling user queries
app.post('/query', async (req, res) => {
  let query = req.body.query;
  query = "context: " + context + " " + query
  console.log('☀️ Query:', query);
  try {
    // Call the OpenAI API with the context and query
    const ollama = new Ollama({
      baseUrl: "http://localhost:11434",
      model: "llama2",
    });
    
    const response = await ollama.invoke(query);
    console.log('== Response:', response);
    res.json({ response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

app.post('/query2', async (req, res) => {
  let query = req.body.query;
  query = "context: " + context + " " + query
  console.log('☀️ Query for mistral:', query);
  try {
    // Call the OpenAI API with the context and query
    const ollama = new Ollama({
      baseUrl: "http://localhost:11434",
      model: "mistral",
    });
    
    const response = await ollama.invoke(query);
    console.log('== Response:', response);
    res.json({ response });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'An error occurred' });
  }
});

//
// Start the server
//
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});