const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

app.post('/waitlist-signup', async (req, res) => {
  const { email, name, referrer_id } = req.body;
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  try {
    const { data, error } = await supabase
      .from('waitlist_signups')
      .insert([{ email, name, referrer_id }]);
    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Email already on waitlist' });
      }
      return res.status(500).json({ error: error.message });
    }
    return res.status(201).json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app; 