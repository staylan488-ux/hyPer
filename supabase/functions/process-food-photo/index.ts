import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface PhotoRequest {
  imageBase64?: string;
  mimeType?: string;
  hint?: string | null;
}

interface VertexFoodDraft {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: number;
  serving_unit: string;
  suggested_servings?: number;
  confidence?: number;
  reasoning?: string;
}

const DEFAULT_LOCATION = Deno.env.get('VERTEX_LOCATION') || 'us-central1';
const DEFAULT_MODEL = Deno.env.get('VERTEX_MODEL') || 'gemini-1.5-flash';
const FALLBACK_MODELS = ['gemini-1.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-1.5-flash-002'];

function base64UrlEncode(input: Uint8Array | string): string {
  const source = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let str = '';
  for (let i = 0; i < source.length; i += 1) {
    str += String.fromCharCode(source[i]);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '');

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function getGoogleAccessToken(serviceAccountJson: string): Promise<string> {
  const serviceAccount = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
    token_uri?: string;
  };

  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('Invalid Google service account credentials');
  }

  const now = Math.floor(Date.now() / 1000);
  const tokenUri = serviceAccount.token_uri || 'https://oauth2.googleapis.com/token';

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenUri,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(serviceAccount.private_key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signedJwt = `${unsignedToken}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenResponse = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signedJwt,
    }),
  });

  if (!tokenResponse.ok) {
    const responseText = await tokenResponse.text();
    throw new Error(`Unable to authenticate with Google: ${responseText}`);
  }

  const tokenData = await tokenResponse.json() as { access_token?: string };

  if (!tokenData.access_token) {
    throw new Error('Google token response missing access token');
  }

  return tokenData.access_token;
}

function extractJson(text: string): string {
  const trimmed = text.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Model response did not include JSON');
  }

  return match[0];
}

function normalizeDraft(input: VertexFoodDraft) {
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0.5));

  return {
    food: {
      name: (input.name || 'Unknown food').trim(),
      calories: Math.max(0, Number(input.calories) || 0),
      protein: Math.max(0, Number(input.protein) || 0),
      carbs: Math.max(0, Number(input.carbs) || 0),
      fat: Math.max(0, Number(input.fat) || 0),
      serving_size: Math.max(1, Number(input.serving_size) || 100),
      serving_unit: (input.serving_unit || 'serving').trim() || 'serving',
      suggested_servings: Math.max(0.25, Number(input.suggested_servings) || 1),
    },
    confidence,
    reasoning: (input.reasoning || '').trim() || null,
  };
}

function parseVertexErrorMessage(responseText: string) {
  try {
    const parsed = JSON.parse(responseText) as { error?: { message?: string } };
    return parsed?.error?.message || responseText;
  } catch {
    return responseText;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const serviceAccountJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
    const projectId = Deno.env.get('GCP_PROJECT_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authHeader = req.headers.get('Authorization');

    const missingEnv: string[] = [];
    if (!serviceAccountJson) missingEnv.push('GOOGLE_SERVICE_ACCOUNT_JSON');
    if (!projectId) missingEnv.push('GCP_PROJECT_ID');
    if (!supabaseUrl) missingEnv.push('SUPABASE_URL');
    if (!supabaseKey) missingEnv.push('SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY');

    if (missingEnv.length > 0) {
      return new Response(JSON.stringify({ error: `Vertex integration is not configured yet. Missing: ${missingEnv.join(', ')}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json() as PhotoRequest;
    const imageBase64 = body.imageBase64?.trim();
    const mimeType = body.mimeType?.trim() || 'image/jpeg';

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Missing image data' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!mimeType.startsWith('image/')) {
      return new Response(JSON.stringify({ error: 'Unsupported file type' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = await getGoogleAccessToken(serviceAccountJson);

    const prompt = [
      'You are a nutrition photo assistant.',
      'Analyze the provided meal photo and optional user hint.',
      'Respond as JSON only with this exact schema:',
      '{',
      '  "name": string,',
      '  "calories": number,',
      '  "protein": number,',
      '  "carbs": number,',
      '  "fat": number,',
      '  "serving_size": number,',
      '  "serving_unit": string,',
      '  "suggested_servings": number,',
      '  "confidence": number,',
      '  "reasoning": string',
      '}',
      'Keep values realistic and conservative. If uncertain, lower confidence.',
      body.hint ? `User hint: ${body.hint}` : 'User hint: none provided',
    ].join('\n');

    const modelCandidates = Array.from(new Set([DEFAULT_MODEL, ...FALLBACK_MODELS]));
    const attemptErrors: string[] = [];

    for (const modelName of modelCandidates) {
      const endpoint = `https://${DEFAULT_LOCATION}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${DEFAULT_LOCATION}/publishers/google/models/${modelName}:generateContent`;

      const vertexResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType,
                    data: imageBase64,
                  },
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            topP: 0.8,
            maxOutputTokens: 400,
            responseMimeType: 'application/json',
          },
        }),
      });

      if (vertexResponse.ok) {
        const payload = await vertexResponse.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };

        const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!rawText) {
          throw new Error('Vertex response did not contain model output');
        }

        const parsed = JSON.parse(extractJson(rawText)) as VertexFoodDraft;
        const normalized = normalizeDraft(parsed);

        return new Response(JSON.stringify(normalized), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const vertexErrorText = await vertexResponse.text();
      const vertexErrorMessage = parseVertexErrorMessage(vertexErrorText);
      attemptErrors.push(`${modelName}: ${vertexErrorMessage}`);

      const lowerMessage = vertexErrorMessage.toLowerCase();
      const isModelAccessIssue =
        vertexResponse.status === 404
        || lowerMessage.includes('not found')
        || lowerMessage.includes('does not have access')
        || lowerMessage.includes('permission denied');

      if (!isModelAccessIssue) {
        return new Response(JSON.stringify({ error: `Vertex request failed (${modelName}): ${vertexErrorMessage}` }), {
          status: 502,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({
      error: `Vertex model access failed in ${DEFAULT_LOCATION}. Tried: ${modelCandidates.join(', ')}. Last error: ${attemptErrors[attemptErrors.length - 1] || 'Unknown error'}`,
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    console.error('process-food-photo error:', message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
