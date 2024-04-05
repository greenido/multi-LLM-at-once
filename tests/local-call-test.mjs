/**
 * This is a test script to call the local Ollama server.
 */
import { Ollama } from "@langchain/community/llms/ollama";

const ollama = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama2",
});

const answer = await ollama.invoke(`write two short jokes`);
console.log(answer);

console.log('Request:', data);
axios.post('http://localhost:11434/api/generate', data)
  .then(response => {
    console.log('Response:', response.data);
  })
  .catch(error => {
    console.error('Error:', error);
  });

