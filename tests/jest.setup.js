// Use a random available port for test runs so they don't conflict
// with a running development server on port 3000.
process.env.PORT = 0;
process.env.NODE_ENV = 'test';
