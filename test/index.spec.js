export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --- 1. XỬ LÝ KHI NGƯỜI DÙNG UPLOAD ẢNH (POST) ---
    if (request.method === "POST" && url.pathname === "/upload") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!file) return new Response("Không tìm thấy file", { status: 400 });

        // A. Lưu ảnh vào R2
        await env.MY_BUCKET.put(file.name, file);

        // B. Gọi AI để phân tích ảnh (Sử dụng model LLaVA)
        const imageArrayBuffer = await file.arrayBuffer();
        const aiResponse = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
          image: [...new Uint8Array(imageArrayBuffer)],
          prompt: "Describe this image in one short sentence",
          max_tokens: 50
        });
        
        const caption = aiResponse.description || "AI không thể mô tả ảnh này.";

        // C. Lưu vào Database D1
        await env.DB.prepare(
          "INSERT INTO images (filename, caption, created_at) VALUES (?, ?, ?)"
        )
        .bind(file.name, caption, new Date().toLocaleString("vi-VN"))
        .run();

        return new Response(JSON.stringify({ status: "Xong", caption }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response("Lỗi hệ thống: " + err.message, { status: 500 });
      }
    }

    // --- 2. XỬ LÝ KHI LẤY DANH SÁCH LỊCH SỬ (GET /history) ---
    if (url.pathname === "/history") {
      const { results } = await env.DB.prepare("SELECT * FROM images ORDER BY id DESC LIMIT 5").all();
      return new Response(JSON.stringify(results), { headers: { "Content-Type": "application/json" } });
    }

    // --- 3. GIAO DIỆN WEB (HTML/CSS/JS) ---
    const html = `
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <title>Cloudflare AI Demo</title>
        <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-50 min-h-screen p-8">
        <div class="max-w-2xl mx-auto bg-white p-8 rounded-2xl shadow-xl">
            <h1 class="text-3xl font-bold text-slate-800 mb-2">Cloudflare Edge AI</h1>
            <p class="text-slate-500 mb-8">Upload ảnh -> AI mô tả -> Lưu Database</p>
            
            <div class="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center mb-6">
                <input type="file" id="fileInput" class="hidden" accept="image/*">
                <label for="fileInput" class="cursor-pointer bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition">
                    Chọn một bức ảnh
                </label>
                <p id="fileName" class="mt-4 text-sm text-slate-400">Chưa có file nào được chọn</p>
            </div>

            <button onclick="uploadFile()" id="btnUpload" class="w-full bg-emerald-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-emerald-600 transition shadow-lg disabled:opacity-50">
                Bắt đầu xử lý với AI tại Edge
            </button>

            <div id="resultArea" class="hidden mt-8 p-6 bg-blue-50 border border-blue-100 rounded-xl">
                <h3 class="font-bold text-blue-800 mb-2 italic">Mô tả từ Workers AI:</h3>
                <p id="captionText" class="text-blue-900 text-lg leading-relaxed"></p>
            </div>

            <div class="mt-12">
                <h2 class="text-xl font-bold text-slate-700 mb-4 text-center">Lịch sử từ Database D1</h2>
                <div id="historyList" class="space-y-3 text-sm"></div>
            </div>
        </div>

        <script>
            const fileInput = document.getElementById('fileInput');
            fileInput.onchange = () => { document.getElementById('fileName').innerText = fileInput.files[0].name; };

            async function uploadFile() {
                const btn = document.getElementById('btnUpload');
                const file = fileInput.files[0];
                if (!file) return alert("Hãy chọn file!");

                btn.disabled = true;
                btn.innerText = "AI đang xử lý... (Vui lòng đợi)";

                const formData = new FormData();
                formData.append('file', file);

                const res = await fetch('/upload', { method: 'POST', body: formData });
                const data = await res.json();

                document.getElementById('resultArea').classList.remove('hidden');
                document.getElementById('captionText').innerText = data.caption;
                
                btn.disabled = false;
                btn.innerText = "Bắt đầu xử lý với AI tại Edge";
                loadHistory();
            }

            async function loadHistory() {
                const res = await fetch('/history');
                const items = await res.json();
                document.getElementById('historyList').innerHTML = items.map(i => 
                    \`<div class="p-3 bg-white border rounded shadow-sm flex justify-between">
                        <span class="font-medium">\${i.filename}</span>
                        <span class="text-slate-400 italic">"\${i.caption}"</span>
                    </div>\`
                ).join('');
            }
            loadHistory();
        </script>
    </body>
    </html>
    `;

    return new Response(html, { headers: { "Content-Type": "text/html" } });
  }
};