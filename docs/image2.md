OpenAI Compatible 文生图：
curl https://api.pixflow.im/v1/images/generations \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "生成一张电商风格商品图",
    "size": "1024x1792"
  }'
  OpenAI Compatible 图生图 / 多参考图：
  curl https://api.pixflow.im/v1/images/edits \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=gpt-image-2" \
  -F "prompt=根据两张参考图生成一张融合风格的新图" \
  -F "size=1024x1024" \
  -F "quality=auto" \
  -F "image[]=@ref1.png" \
  -F "image[]=@ref2.png"
  Gemini 图片：
  curl "https://api.pixflow.im/v1beta/models/gemini-3.1-flash-image:generateContent" \
  -H "x-goog-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {
        "role": "user",
        "parts": [{"text": "生成一张 9:16 竖屏电商图片"}]
      }
    ],
    "generationConfig": {
      "responseModalities": ["TEXT", "IMAGE"],
      "imageConfig": {
        "imageSize": "1K",
        "aspectRatio": "9:16"
      }
    }
  }'

  通用端点和参数
  curl https://api.pixflow.im/v1/images/generations \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "生成一张电商风格商品图，白色背景，真实商业摄影风格",
    "size": "1024x1024"
  }'
  图生图 / 多参考图使用 /v1/images/edits。通用写法是 multipart/form-data 文件上传。
  curl https://api.pixflow.im/v1/images/edits \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=gpt-image-2" \
  -F "prompt=参考第一张图的主体和第二张图的配色，生成一张新图" \
  -F "size=1024x1024" \
  -F "image[]=@ref1.png" \
  -F "image[]=@ref2.png"
  
  GPT Image2 固定价
curl https://api.pixflow.im/v1/images/generations \
  -H "Authorization: Bearer <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "Create a premium product hero image, clean white background, realistic commercial photography.",
    "size": "1792x1024",
    "n": 1,
    "quality": "auto"
  }'
  图生图 / 多参考图示例
  curl https://api.pixflow.im/v1/images/edits \
  -H "Authorization: Bearer <API_KEY>" \
  -F "model=gpt-image-2" \
  -F "prompt=保持第一张图的人物姿态，参考第二张图的产品材质，生成电商海报风格图片，不要文字" \
  -F "size=1024x1024" \
  -F "image[]=@person.png" \
  -F "image[]=@product.png"
  响应示例：

{
  "created": 1778679076,
  "data": [
    {
      "b64_json": "iVBORw0KGgoAAAANSUhEUgAA..."
    }
  ]
}