onetoken调用image2
curl [https://api.onetoken.one/v1/images/generations/](https://api.onetoken.one/v1/images/generations) \
 -H "Content-Type: application/json" \
 -H "Authorization: Bearer sk-xxxxxxxxxxxx" \
 -d '{
"model": "gpt-image-2",
"prompt": "A futuristic city with flying cars at sunset, cyberpunk style, highly detailed",
"n": 1,
"size": "1024x1024"
}'
key:"sk-MFCNDL0uYhSGjvscmTjiiZKZ3j4BEUVZGCg66OD4f52O7es0"

otu调用image2
curl -X POST "https://xxxxxx.com/v1/images/generations" \
 -H "Authorization: Bearer YOUR_API_KEY" \
 -H "Content-Type: application/json" \
 -d '{
"model": "image2",
"prompt": "生成竖屏图片 xxx抖音带货",
"size": "1024x1792"
}'
curl -X POST "https://xxxxxx.com/v1/images/generations" \
 -H "Authorization: Bearer YOUR_API_KEY" \
 -H "Content-Type: application/json" \
 -d "{
\"model\": \"image2\",
\"prompt\": \"广告\",
\"size\": \"1024x1792\",
\"image\": [
\"https://res.papir.cc/user-upload/creati-web-app/2026-04-18/1776519962551vv1AXmBu-ZMWqAckJIbt81167-600x751h.jpg\",
\"https://www.baidu.com/img/PCtm_d9c8750bed0b3c7d089fa7d55720d6cf.png\"
]
}"
key sk-9X5C6gFQNPI5zcca5d9rMadMdnELOMlhf7NsgRNSK9RU5ZXJ
