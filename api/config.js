// Vercel serverless function: отдаёт публичные ключи Supabase из переменных окружения,
// чтобы они не были прописаны в исходнике index.html.
// Локально значения берутся из .env.local (Vercel CLI: `vercel dev` подхватывает его сам),
// в проде — из Project Settings -> Environment Variables на vercel.com.
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || ''
  });
};
