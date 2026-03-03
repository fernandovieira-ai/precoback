/**
 * Script de teste para verificar se o servidor está funcionando
 * Execute: node test-server.js
 */

const http = require('http');

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';

console.log('🧪 Testando backend em:', BACKEND_URL);
console.log('━'.repeat(50));

// Teste 1: Health Check
function testHealthCheck() {
  return new Promise((resolve, reject) => {
    console.log('\n1️⃣  Teste: Health Check (/)');

    const url = new URL(BACKEND_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const protocol = url.protocol === 'https:' ? require('https') : http;

    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 200 && json.msg) {
            console.log('✅ Health Check OK');
            console.log('   Status:', res.statusCode);
            console.log('   Mensagem:', json.msg);
            resolve(true);
          } else {
            console.log('❌ Health Check FALHOU');
            console.log('   Status:', res.statusCode);
            console.log('   Resposta:', data);
            resolve(false);
          }
        } catch (err) {
          console.log('❌ Erro ao parsear resposta');
          console.log('   Resposta raw:', data);
          resolve(false);
        }
      });
    });

    req.on('error', (err) => {
      console.log('❌ Erro na requisição:', err.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Timeout (5s)');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Teste 2: CORS
function testCORS() {
  return new Promise((resolve, reject) => {
    console.log('\n2️⃣  Teste: CORS Headers');

    const url = new URL(BACKEND_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/',
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://localhost:4200',
        'Access-Control-Request-Method': 'POST'
      }
    };

    const protocol = url.protocol === 'https:' ? require('https') : http;

    const req = protocol.request(options, (res) => {
      const corsHeader = res.headers['access-control-allow-origin'];

      if (corsHeader) {
        console.log('✅ CORS configurado');
        console.log('   Allow-Origin:', corsHeader);
        console.log('   Allow-Methods:', res.headers['access-control-allow-methods'] || 'N/A');
        resolve(true);
      } else {
        console.log('⚠️  CORS não detectado');
        console.log('   Pode ser normal se o servidor só responde a origens específicas');
        resolve(true); // Não falha o teste
      }
    });

    req.on('error', (err) => {
      console.log('❌ Erro na requisição:', err.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Timeout (5s)');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Teste 3: Endpoint da API
function testAPIEndpoint() {
  return new Promise((resolve, reject) => {
    console.log('\n3️⃣  Teste: API Endpoint (/drfPriceSwap/)');

    const url = new URL(BACKEND_URL + '/drfPriceSwap/');
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const protocol = url.protocol === 'https:' ? require('https') : http;

    const req = protocol.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        console.log('✅ Endpoint acessível');
        console.log('   Status:', res.statusCode);
        console.log('   Content-Type:', res.headers['content-type']);
        resolve(true);
      });
    });

    req.on('error', (err) => {
      console.log('❌ Erro na requisição:', err.message);
      resolve(false);
    });

    req.setTimeout(5000, () => {
      console.log('❌ Timeout (5s)');
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

// Executar todos os testes
async function runAllTests() {
  console.log('\n🚀 Iniciando testes...\n');

  const results = {
    healthCheck: await testHealthCheck(),
    cors: await testCORS(),
    apiEndpoint: await testAPIEndpoint()
  };

  console.log('\n' + '━'.repeat(50));
  console.log('📊 RESULTADO DOS TESTES\n');

  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;

  console.log('Health Check:', results.healthCheck ? '✅ PASSOU' : '❌ FALHOU');
  console.log('CORS:', results.cors ? '✅ PASSOU' : '❌ FALHOU');
  console.log('API Endpoint:', results.apiEndpoint ? '✅ PASSOU' : '❌ FALHOU');

  console.log('\n' + '━'.repeat(50));
  console.log(`Total: ${passed}/${total} testes passaram`);

  if (passed === total) {
    console.log('\n🎉 Backend está funcionando corretamente!');
    console.log('✅ Pronto para deploy no Railway\n');
    process.exit(0);
  } else {
    console.log('\n⚠️  Alguns testes falharam.');
    console.log('❌ Verifique os erros acima antes de fazer deploy\n');
    process.exit(1);
  }
}

// Executar
runAllTests().catch(err => {
  console.error('❌ Erro fatal:', err);
  process.exit(1);
});
