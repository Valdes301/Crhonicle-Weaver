import { GoogleGenAI } from '@google/genai';
import { getAppSetting } from '@/lib/db';
import { log } from '@/lib/logger';
import { logApiUsage } from '@/lib/db';

/**
 * Trova la prima chiave API Gemini valida tra quelle disponibili nell'ambiente.
 */
export function getActiveGeminiApiKey(preferredEnv?: string): string | null {
  const candidates = [
    preferredEnv ? process.env[preferredEnv] : undefined,
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GEMINI_API_KEY_WORLD,
    process.env.GEMINI_API_KEY_STORY,
    process.env.GEMINI_API_KEY_EXTRACTION,
    process.env.GEMINI_API_KEY_IMPORT,
    process.env.GEMINI_API_KEY_SHOPS,
    process.env.GEMINI_API_KEY_SUMMARY,
  ];

  const invalidValues = [
    '',
    'undefined',
    'null',
    'tua_chiave_qui',
    'your_key_here',
    '<your_key_here>',
    'insert_key_here',
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const clean = candidate.trim();
    if (clean && !invalidValues.includes(clean.toLowerCase()) && !clean.startsWith('YOUR_')) {
      return clean;
    }
  }

  return null;
}

export function getAllValidGeminiApiKeys(): string[] {
  const candidates = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GEMINI_API_KEY_WORLD,
    process.env.GEMINI_API_KEY_STORY,
    process.env.GEMINI_API_KEY_EXTRACTION,
    process.env.GEMINI_API_KEY_IMPORT,
    process.env.GEMINI_API_KEY_SHOPS,
    process.env.GEMINI_API_KEY_SUMMARY,
  ];

  try {
    const savedKey = getAppSetting('gemini_api_key');
    if (savedKey) candidates.push(savedKey);
  } catch {}

  const invalidValues = [
    '',
    'undefined',
    'null',
    'tua_chiave_qui',
    'your_key_here',
    '<your_key_here>',
    'insert_key_here',
  ];

  const validKeys: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const clean = candidate.trim();
    if (clean && !invalidValues.includes(clean.toLowerCase()) && !clean.startsWith('YOUR_') && !validKeys.includes(clean)) {
      validKeys.push(clean);
    }
  }

  if (validKeys.length === 0) {
    validKeys.push(process.env.GEMINI_API_KEY || 'AIzaSy_placeholder');
  }

  return validKeys;
}

let inMemoryFallbackModel: string | null = null;

export function sanitizeModelName(modelName: string): string {
  if (!modelName) return 'gemini-3.8-flash';
  const clean = modelName.trim().replace(/^googleai\//i, '');
  return clean;
}

/**
 * Recupera dinamicamente il modello Flash attivo configurato dall'utente (da SQLite o da ENV).
 * Supporta la selezione del modello per singola sezione (es. STORY, WORLD, SHOPS, IMPORT, EXTRACTION).
 */
export function getActiveFlashModel(serviceName?: string): string {
  if (serviceName) {
    try {
      const sectionSaved = getAppSetting(`model_service_${serviceName}`);
      if (sectionSaved && sectionSaved.trim() && sectionSaved.trim() !== 'default') {
        return sanitizeModelName(sectionSaved.trim());
      }
    } catch {}
  }
  if (inMemoryFallbackModel) {
    return sanitizeModelName(inMemoryFallbackModel);
  }
  try {
    const saved = getAppSetting('active_ai_model');
    if (saved && saved.trim()) {
      return sanitizeModelName(saved.trim());
    }
  } catch {}
  return sanitizeModelName(process.env.GEMINI_FLASH_MODEL || 'gemini-3.8-flash');
}

/**
 * Modello Flash predefinito per compatibilità retroattiva.
 */
export const DEFAULT_FLASH_MODEL = 'gemini-3.8-flash';

let activeOperationsAbortFlag = false;

/**
 * Interrompe immediatamente tutte le operazioni IA in corso lato server.
 */
export function abortActiveAiOperations() {
  activeOperationsAbortFlag = true;
  log(`[GenAI] Ricevuto segnale di abort immediato da parte dell'utente.`);
  setTimeout(() => {
    activeOperationsAbortFlag = false;
  }, 4000);
}

export function isAiOperationAborted(): boolean {
  return activeOperationsAbortFlag;
}

/**
 * Esegue generateContent con fallback e retries intelligenti sui modelli attivi supportati.
 */
export async function safeGenerateContent(
  genAi: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  serviceName?: string
) {
  if (isAiOperationAborted()) {
    throw new Error("Operazione IA interrotta dall'utente.");
  }

  const activeModel = getActiveFlashModel(serviceName);
  
  // Whitelist modelli consentiti e mappatura
  const allowedModels = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-2.5-flash'];
  const rawRequested = sanitizeModelName(params.model || activeModel);
  const requestedModel = rawRequested === 'gemini-flash-latest' ? 'gemini-3.5-flash' : rawRequested;
  const primaryModel = allowedModels.includes(requestedModel) 
    ? requestedModel 
    : 'gemini-3.8-flash';
  
  const modelsToTry = [primaryModel, ...allowedModels.filter(m => m !== primaryModel)];
  const apiKeys = getAllValidGeminiApiKeys();

  let lastError: any = null;
  let totalAttempts = 0;
  const MAX_TOTAL_ATTEMPTS = 5; // Fino a 5 tentativi per consentire rotazione completa tra modelli e chiavi
  let consecutiveQuotaErrors = 0;

  for (const model of modelsToTry) {
    if (isAiOperationAborted()) {
      throw new Error("Operazione IA interrotta dall'utente.");
    }
    if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
      break;
    }

    for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
      if (isAiOperationAborted()) {
        throw new Error("Operazione IA interrotta dall'utente.");
      }
      if (totalAttempts >= MAX_TOTAL_ATTEMPTS) {
        break;
      }
      // Se abbiamo già riscontrato 2 errori 429 di quota consecutivi, interrompi il ciclo (progetto saturo)
      if (consecutiveQuotaErrors >= 2) {
        log(`[GenAI Circuit Breaker] Rilevati molteplici errori di quota (429). Interruzione a cascata per proteggere le risorse.`);
        break;
      }

      totalAttempts++;
      const apiKey = apiKeys[keyIdx];
      const client = keyIdx === 0 ? genAi : new GoogleGenAI({ apiKey });
      
      log(`[GenAI] Tentativo ${totalAttempts}/${MAX_TOTAL_ATTEMPTS} con modello ${model}, chiave API #${keyIdx + 1}`);
      
      // Breve pausa solo tra tentativi successivi al primo
      if (totalAttempts > 1) {
        for (let waited = 0; waited < 800; waited += 100) {
          if (isAiOperationAborted()) {
            throw new Error("Operazione IA interrotta dall'utente.");
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      try {
        const generatePromise = client.models.generateContent({
          ...params,
          model: model,
        });

        let timerId: any = null;
        const timeoutPromise = new Promise((_, reject) => {
          timerId = setTimeout(() => {
            reject(new Error(`Timeout chiamata IA su modello ${model} superato (35s)`));
          }, 35000);
          if (timerId?.unref) timerId.unref();
        });

        const res = await Promise.race([generatePromise, timeoutPromise]) as any;
        clearTimeout(timerId);

        log(`[GenAI] Successo con modello ${model}`);
        await logApiUsage(serviceName || 'IMPORT', 'success');
        return res;
      } catch (err: any) {
        lastError = err;
        await logApiUsage(serviceName || 'IMPORT', 'error');
        
        let msg = '';
        try {
          msg = err?.message || JSON.stringify(err);
        } catch {
          msg = String(err);
        }

        log(`[GenAI] Errore con modello ${model}, chiave API #${keyIdx + 1}: ${msg}`);
        
        const is503 = msg.includes('503') || 
                      msg.toLowerCase().includes('high demand') || 
                      msg.toLowerCase().includes('unavailable') || 
                      msg.toLowerCase().includes('overloaded');
        const isTimeout = msg.toLowerCase().includes('timeout');
        const isQuotaError = msg.includes('429') || 
                             msg.toLowerCase().includes('quota') || 
                             msg.toLowerCase().includes('too many requests') || 
                             msg.toLowerCase().includes('resource_exhausted') || 
                             msg.toLowerCase().includes('resource exhausted') || 
                             msg.toLowerCase().includes('exceeded') ||
                             err?.status === 'RESOURCE_EXHAUSTED' ||
                             err?.code === 429;

        if (isQuotaError) {
          consecutiveQuotaErrors++;
          // Continua provando la prossima chiave API per la quota
        } else if (is503 || isTimeout) {
          // Su 503 (sovraccarico di Google) o timeout 35s, cambiare chiave per lo stesso modello è inutile.
          // Failover immediato: interrompi il ciclo di chiavi per questo modello e passa al modello successivo!
          log(`[GenAI Failover Immediato] Modello ${model} sovraccarico o lento (${is503 ? '503 High Demand' : 'Timeout 35s'}). Passaggio immediato al modello successivo...`);
          consecutiveQuotaErrors = 0;
          break;
        } else {
          consecutiveQuotaErrors = 0;
        }
      }
    }
  }

  const rawErrorMsg = lastError?.message || (typeof lastError === 'object' ? JSON.stringify(lastError) : String(lastError));
  log(`[GenAI Error] Tutti i tentativi esauriti (${totalAttempts}/${MAX_TOTAL_ATTEMPTS}): ${rawErrorMsg}`);

  const is503 = rawErrorMsg.includes('503') || rawErrorMsg.toLowerCase().includes('service unavailable') || rawErrorMsg.toLowerCase().includes('high demand') || rawErrorMsg.toLowerCase().includes('overloaded');
  const isTimeout = rawErrorMsg.includes('524') || rawErrorMsg.toLowerCase().includes('timeout');
  const is429 = rawErrorMsg.includes('429') || rawErrorMsg.toLowerCase().includes('quota') || rawErrorMsg.toLowerCase().includes('resource_exhausted');

  if (isTimeout) {
    throw new Error("Servizio IA troppo lento (Timeout / 524). Riprova dopo aver ridotto la complessità dell'immagine.");
  } else if (is503) {
    throw new Error("Servizio IA temporaneamente occupato (Service Unavailable / 503). Riprova tra qualche secondo.");
  } else if (is429) {
    throw new Error("Quota IA momentaneamente esaurita (Rate Limit / 429). Riprova tra poco.");
  }

  // Garantisce che venga SEMPRE sollevata un'eccezione esplicita e non venga mai ritornato undefined
  throw new Error(rawErrorMsg || "Tutti i tentativi con il modello IA sono falliti.");
}

/**
 * Testa la connettività e la latenza di un modello specifico con un ping leggero.
 */
export async function testGeminiModel(modelName: string): Promise<{ success: boolean; latencyMs?: number; message?: string; error?: string }> {
  const startTime = Date.now();
  try {
    const genAi = getGenAI();
    const cleanModel = modelName.startsWith('googleai/') ? modelName.replace('googleai/', '') : modelName;
    const response = await genAi.models.generateContent({
      model: cleanModel,
      contents: 'Rispondi esclusivamente con la parola "OK".',
      config: {
        maxOutputTokens: 10,
        temperature: 0.1,
      },
    });
    const latencyMs = Date.now() - startTime;
    const text = response.text || '';
    return {
      success: true,
      latencyMs,
      message: `Modello ${cleanModel} operativo! Risposta ricevuta in ${latencyMs}ms ("${text.trim().substring(0, 30)}")`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    return {
      success: false,
      latencyMs,
      error: err?.message || String(err),
    };
  }
}

/**
 * Ottiene un'istanza GoogleGenAI configurata con la chiave corretta.
 */
export function getGenAI(preferredEnv?: string): GoogleGenAI {
  const key = getActiveGeminiApiKey(preferredEnv);
  if (!key) {
    throw new Error(
      "Nessuna chiave API Gemini configurata. Vai su Impostazioni per inserire una chiave API valida (GEMINI_API_KEY)."
    );
  }

  // Sincronizza per sicurezza le variabili globali
  if (!process.env.GEMINI_API_KEY) process.env.GEMINI_API_KEY = key;
  if (!process.env.GOOGLE_GENAI_API_KEY) process.env.GOOGLE_GENAI_API_KEY = key;

  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'dnd-chronicle-weaver',
      },
    },
  });
}
