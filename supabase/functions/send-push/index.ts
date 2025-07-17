// @ts-nocheck
import { serve } from 'https://deno.land/std@0.203.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  
  console.log('send-push function called');
  
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('Received payload:', payload);
    
    const { userId, title, body, data } = payload;
    if (!userId || !title || !body) {
      console.log('Missing required fields:', { userId, title, body });
      return new Response('Missing fields', { status: 400, headers: corsHeaders });
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log('Looking up device tokens for user:', userId);
    // Fetch device tokens
    const { data: tokens, error } = await supabase
      .from('device_push_tokens')
      .select('token')
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase query error', error);
      return new Response(JSON.stringify({ error: 'Database error', details: error }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log('Found tokens:', tokens?.length || 0);
    if (!tokens || tokens.length === 0) {
      console.log('No device tokens found for user');
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'No device tokens found for user',
        userId 
      }), { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Extract token strings
    const tokenStrings = tokens.map(row => row.token);
    
    // Call the Node.js backend to send push notifications
    const backendUrl = Deno.env.get('PUSH_BACKEND_URL') || 'https://runcrew-push-backend-1.onrender.com/api/send-push';
    
    console.log('Calling Node.js backend:', backendUrl);
    const backendResponse = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userId,
        title,
        body,
        data,
        tokens: tokenStrings,
      }),
    });

    if (!backendResponse.ok) {
      const errorText = await backendResponse.text();
      console.error('Backend error:', errorText);
      return new Response(JSON.stringify({ 
        error: 'Backend error', 
        details: errorText 
      }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const backendResult = await backendResponse.json();
    console.log('Backend result:', backendResult);

    return new Response(JSON.stringify({
      success: true,
      message: 'Push notification sent via Node.js backend',
      userId,
      title,
      body,
      tokenCount: tokens.length,
      backendResult,
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
}); 