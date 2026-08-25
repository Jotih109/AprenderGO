import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '../screenshots');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Find browser executable
const chromePaths = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
];

let executablePath = chromePaths.find(p => fs.existsSync(p));
if (!executablePath) {
  console.error('Nenhum navegador Chrome ou Edge encontrado.');
  process.exit(1);
}

console.log(`Usando navegador: ${executablePath}`);
console.log(`Salvando capturas em: ${outputDir}`);

async function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--window-size=1920,1080',
      '--force-device-scale-factor=2'
    ],
    defaultViewport: {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 2
    }
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

  // Auto-accept all browser alerts / confirms
  page.on('dialog', async dialog => {
    console.log(`Dialog aberto: [${dialog.type()}] ${dialog.message()}`);
    await dialog.accept();
  });

  console.log('Navegando para http://localhost:3000 ...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle0' });
  await wait(1000);

  // 1. Partida Principal 19x19 (Kaya Tradicional)
  console.log('📸 [01/17] Capturando 01_partida_19x19_kaya.png...');
  await page.screenshot({ path: path.join(outputDir, '01_partida_19x19_kaya.png') });

  // 2. Modal Nova Partida
  console.log('📸 [02/17] Capturando 02_modal_nova_partida.png...');
  await page.click('#btn-new-game-modal');
  await wait(500);
  await page.screenshot({ path: path.join(outputDir, '02_modal_nova_partida.png') });
  await page.evaluate(() => {
    document.getElementById('modal-new-game')?.classList.remove('show');
  });
  await wait(400);

  // 3. Modal Biblioteca de Partidas (SGF)
  console.log('📸 [03/17] Capturando 03_modal_biblioteca_sgf.png...');
  await page.click('#btn-open-library-sidebar');
  await wait(600);
  await page.screenshot({ path: path.join(outputDir, '03_modal_biblioteca_sgf.png') });

  // 4. Carregar partida e capturar jogo em andamento 9x9
  console.log('Carregando partida da biblioteca...');
  await page.evaluate(() => {
    const cards = document.querySelectorAll('.review-game-card');
    if (cards.length > 0) {
      const openBtn = cards[0].querySelector('.btn-secondary');
      if (openBtn) openBtn.click();
    }
  });
  await wait(800);
  console.log('📸 [04/17] Capturando 04_partida_em_andamento_9x9.png...');
  await page.screenshot({ path: path.join(outputDir, '04_partida_em_andamento_9x9.png') });

  // 5. Ativar Mapa de Influência Territorial
  console.log('📸 [05/17] Capturando 05_mapa_influencia_territorio.png...');
  await page.click('#btn-toggle-influence');
  await wait(600);
  await page.screenshot({ path: path.join(outputDir, '05_mapa_influencia_territorio.png') });
  await page.click('#btn-toggle-influence'); // desligar
  await wait(400);

  // 6. Iniciar Análise Pós-Jogo Completa (Game Review com IA)
  console.log('Iniciando análise pós-jogo completa com IA Sensei...');
  await page.click('#btn-review-trigger');
  console.log('Aguardando IA calcular simulações e win rate...');
  await page.waitForFunction(() => {
    const modal = document.getElementById('modal-review-progress');
    return !modal || !modal.classList.contains('show');
  }, { timeout: 35000 });
  await wait(1200);

  console.log('📸 [06/17] Capturando 06_analise_pos_jogo_completa.png...');
  await page.screenshot({ path: path.join(outputDir, '06_analise_pos_jogo_completa.png') });

  // 7. Navegar para um lance com erro tático / explicação didática
  console.log('Navegando para lance crítico...');
  await page.evaluate(() => {
    const blunderBtn = document.getElementById('btn-review-next-blunder');
    if (blunderBtn) blunderBtn.click();
  });
  await wait(800);
  console.log('📸 [07/17] Capturando 07_analise_detalhe_lance_aprendiz.png...');
  await page.screenshot({ path: path.join(outputDir, '07_analise_detalhe_lance_aprendiz.png') });

  // 8. Modal de Seleção de Tsumego
  console.log('Abrindo aba Tsumego...');
  await page.click('#tab-tsumego');
  await wait(600);
  console.log('📸 [08/17] Capturando 08_tsumego_selecao_problemas.png...');
  await page.screenshot({ path: path.join(outputDir, '08_tsumego_selecao_problemas.png') });

  // 9. Selecionar um Tsumego para resolver
  console.log('Carregando problema de Tsumego no tabuleiro...');
  await page.evaluate(() => {
    const puzzles = document.querySelectorAll('.puzzle-item');
    if (puzzles.length > 0) puzzles[0].click();
  });
  await wait(800);
  console.log('📸 [09/17] Capturando 09_tsumego_resolvendo_puzzle.png...');
  await page.screenshot({ path: path.join(outputDir, '09_tsumego_resolvendo_puzzle.png') });

  // 10. Explorador de Joseki (Aberturas)
  console.log('Abrindo aba Joseki...');
  await page.click('#tab-joseki');
  await wait(600);
  await page.evaluate(() => {
    const items = document.querySelectorAll('.puzzle-item');
    if (items.length > 0) items[0].click();
  });
  await wait(800);
  console.log('📸 [10/17] Capturando 10_dicionario_joseki_aberturas.png...');
  await page.screenshot({ path: path.join(outputDir, '10_dicionario_joseki_aberturas.png') });

  // 11. Modal Glossário de Conceitos
  console.log('Abrindo Glossário de Conceitos...');
  await page.evaluate(() => {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.classList.remove('show'));
    const glossaryModal = document.getElementById('modal-glossary');
    if (glossaryModal) glossaryModal.classList.add('show');
  });
  await wait(600);
  console.log('📸 [11/17] Capturando 11_glossario_conceitos_didatico.png...');
  await page.screenshot({ path: path.join(outputDir, '11_glossario_conceitos_didatico.png') });
  await page.evaluate(() => {
    document.getElementById('modal-glossary')?.classList.remove('show');
  });
  await wait(400);

  // 12. Modal Regras e Guia Completo
  console.log('Abrindo Guia de Regras...');
  await page.click('#tab-rules');
  await wait(600);
  console.log('📸 [12/17] Capturando 12_modal_regras_e_guia.png...');
  await page.screenshot({ path: path.join(outputDir, '12_modal_regras_e_guia.png') });
  await page.evaluate(() => {
    document.getElementById('modal-rules-guide')?.classList.remove('show');
  });
  await wait(400);

  // 13. Modal de Contagem de Pontos Final (Scoring)
  console.log('Abrindo Modal de Contagem de Pontos...');
  await page.evaluate(() => {
    const scoringModal = document.getElementById('modal-scoring');
    if (scoringModal) scoringModal.classList.add('show');
  });
  await wait(600);
  console.log('📸 [13/17] Capturando 13_modal_contagem_pontos_final.png...');
  await page.screenshot({ path: path.join(outputDir, '13_modal_contagem_pontos_final.png') });
  await page.evaluate(() => {
    document.getElementById('modal-scoring')?.classList.remove('show');
  });
  await wait(400);

  // 14. Modal Colar SGF
  console.log('Abrindo Modal Colar SGF...');
  await page.evaluate(() => {
    const pasteModal = document.getElementById('modal-paste-sgf');
    if (pasteModal) {
      const textarea = document.getElementById('paste-sgf-textarea');
      if (textarea) textarea.value = `(;FF[4]GM[1]SZ[19]PB[Jogador 1]PW[Jogador 2]KM[6.5]RU[Japanese];B[pd];W[dp];B[pq];W[dd];B[qk];W[nc];B[qf];W[jd];B[fq];W[cn])`;
      pasteModal.classList.add('show');
    }
  });
  await wait(500);
  console.log('📸 [14/17] Capturando 14_modal_colar_sgf.png...');
  await page.screenshot({ path: path.join(outputDir, '14_modal_colar_sgf.png') });
  await page.evaluate(() => {
    document.getElementById('modal-paste-sgf')?.classList.remove('show');
  });
  await wait(400);

  // 15. Tema Estúdio Noturno (Dark)
  console.log('📸 [15/17] Capturando 15_tema_estudio_noturno_dark.png...');
  await page.click('#tab-play');
  await wait(300);
  await page.evaluate(() => {
    document.getElementById('modal-new-game')?.classList.remove('show');
  });
  await page.select('#theme-select', 'dark');
  await wait(600);
  await page.screenshot({ path: path.join(outputDir, '15_tema_estudio_noturno_dark.png') });

  // 16. Tema Cyber Baduk (Neon)
  console.log('📸 [16/17] Capturando 16_tema_cyber_baduk_neon.png...');
  await page.select('#theme-select', 'cyber');
  await wait(600);
  await page.screenshot({ path: path.join(outputDir, '16_tema_cyber_baduk_neon.png') });

  // 17. Tema Papel Washi
  console.log('📸 [17/17] Capturando 17_tema_papel_washi.png...');
  await page.select('#theme-select', 'washi');
  await wait(600);
  await page.screenshot({ path: path.join(outputDir, '17_tema_papel_washi.png') });

  // Restaurar tema Kaya
  await page.select('#theme-select', 'kaya');
  await wait(300);

  await browser.close();
  console.log(`\n🎉 Sucesso! Todas as 17 capturas foram salvas com perfeição em: ${outputDir}`);
}

run().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
