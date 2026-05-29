可使用模型
当前订阅套餐只支持使用以下模型列表
品牌
模型
模型能力
千问
qwen3.7-max
推理模型、文本生成
qwen3.6-plus
推理模型、视觉理解、文本生成
qwen3.6-flash
推理模型、视觉理解、文本生成
qwen-image-2.0
图片生成
qwen-image-2.0-pro
图片生成
万相
wan2.7-image
图片生成
wan2.7-image-pro
图片生成
DeepSeek
deepseek-v4-pro
推理模型、文本生成
deepseek-v4-flash
文本生成、推理模型
deepseek-v3.2
推理模型、文本生成
月之暗面
kimi-k2.6
推理模型、视觉理解、文本生成
kimi-k2.5
推理模型、视觉理解、文本生成
智谱AI
glm-5.1
文本生成
glm-5
文本生成
MiniMax
MiniMax-M2.5
推理模型、文本生成
文本对话
# 各地域配置不同，请根据实际地域修改
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "qwen3.6-plus",
    "messages": [
        {
            "role": "system",
            "content": "You are a helpful assistant."
        },
        {
            "role": "user", 
            "content": "你是谁？"
        }
    ]
}'
返回结果
{
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": "我是千问，阿里巴巴集团旗下的通义实验室自主研发的超大规模语言模型。我可以帮助你回答问题、创作文字，比如写故事、写公文、写邮件、写剧本、逻辑推理、编程等等，还能表达观点，玩游戏等。如果你有任何问题或需要帮助，欢迎随时告诉我！"
            },
            "finish_reason": "stop",
            "index": 0,
            "logprobs": null
        }
    ],
    "object": "chat.completion",
    "usage": {
        "prompt_tokens": 26,
        "completion_tokens": 66,
        "total_tokens": 92
    },
    "created": 1726127645,
    "system_fingerprint": null,
    "model": "qwen3.6-plus",
    "id": "chatcmpl-81951b98-28b8-9659-ab07-xxxxxx"
}
多轮对话
# ======= 重要提示 =======
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下为北京地域url，若使用新加坡地域的模型，需将base_url替换为：https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation
# === 执行时请删除该注释 ===

curl -X POST https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "qwen-plus",
    "input":{
        "messages":[      
            {
                "role": "system",
                "content": "You are a helpful assistant."
            },
            {
                "role": "user",
                "content": "你好"
            },
            {
                "role": "assistant",
                "content": "你好啊，我是通义千问。"
            },
            {
                "role": "user",
                "content": "你有哪些技能？"
            }
        ]
    }
}'
多模态的多轮对话
# ======= 重要提示 =======
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
# === 执行时请删除该注释 ===

curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H 'Content-Type: application/json' \
-d '{
  "model": "qwen3-vl-plus",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {
            "url": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20251031/ownrof/f26d201b1e3f4e62ab4a1fc82dd5c9bb.png"
          }
        },
        {
          "type": "text",
          "text": "请问图片展现了有哪些商品？"
        }
      ]
    },
    {
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "图片展示了三件商品：一件浅蓝色背带裤、一件蓝白条纹短袖衬衫和一双白色运动鞋。"
        }
      ]
    },
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "它们属于什么风格？"
        }
      ]
    }
  ]
}'
流式输出
# ======= 重要提示 =======
# 确保已设置环境变量 DASHSCOPE_API_KEY
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下是北京地域base_url，如果使用新加坡地域的模型，需要将base_url替换为：https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions
# === 执行时请删除该注释 ===
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
--no-buffer \
-d '{
    "model": "qwen-plus",
    "messages": [
        {"role": "user", "content": "你是谁？"}
    ],
    "stream": true,
    "stream_options": {"include_usage": true}
}'
响应
data: {"choices":[{"delta":{"content":"","role":"assistant"},"index":0,"logprobs":null,"finish_reason":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"finish_reason":null,"delta":{"content":"我是"},"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"delta":{"content":"来自"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"delta":{"content":"阿里"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"delta":{"content":"云的超大规模语言"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"delta":{"content":"模型，我叫通义千问"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"delta":{"content":"。"},"finish_reason":null,"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[{"finish_reason":"stop","delta":{"content":""},"index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: {"choices":[],"object":"chat.completion.chunk","usage":{"prompt_tokens":22,"completion_tokens":17,"total_tokens":39},"created":1726132850,"system_fingerprint":null,"model":"qwen-plus","id":"chatcmpl-428b414f-fdd4-94c6-b179-8f576ad653a8"}

data: [DONE]
前缀续写
# ======= 重要提示 =======
# 各地域的API Key不同。获取API Key：https://help.aliyun.com/zh/model-studio/get-api-key
# 以下为北京地域url，若使用新加坡地域的模型，需将url替换为：https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/text-generation/generation
# === 执行时请删除该注释 ===
curl -X POST "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation" \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "qwen3-coder-plus",
    "input":{
        "messages":[
            {
                "role": "user",
                "content": "请补全这个斐波那契函数，勿添加其它内容"
            },
            {
                "role": "assistant",
                "content": "def calculate_fibonacci(n):\n    if n <= 1:\n        return n\n    else:\n",
                "partial": true
            }
        ]
    },
    "parameters": {
        "result_format": "message"
    }
}'
返回结果
{
    "output": {
        "choices": [
            {
                "message": {
                    "content": "        return calculate_fibonacci(n-1) + calculate_fibonacci(n-2)",
                    "role": "assistant"
                },
                "finish_reason": "stop"
            }
        ]
    },
    "usage": {
        "total_tokens": 67,
        "output_tokens": 19,
        "input_tokens": 48,
        "prompt_tokens_details": {
            "cached_tokens": 0
        }
    },
    "request_id": "c61c62e5-cf97-90bc-a4ee-50e5e117b93f"
}
文本生成图像
该请求会返回一个任务ID（task_id）。
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation' \
--header 'Content-Type: application/json' \
--header "Authorization: Bearer $DASHSCOPE_API_KEY" \
--header "X-DashScope-Async: enable" \
--data '{
    "model": "wan2.7-image-pro",
    "input": {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"text": "一间有着精致窗户的花店，漂亮的木质门，摆放着花朵"}
                ]
            }
        ]
    },
    "parameters": {
        "size": "2K",
        "n": 1,
        "watermark": false,
        "thinking_mode": true
    }
}'
步骤2：根据任务ID查询结果
使用上一步获取的 task_id，通过接口轮询任务状态，直到 task_status 变为 SUCCEEDED 或 FAILED。

将{task_id}完整替换为上一步接口返回的task_id的值。task_id查询有效期为24小时。
curl -X GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id} \
--header "Authorization: Bearer $DASHSCOPE_API_KEY"
人像风格重绘
设置style_index（不能设为-1）。
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation' \
--header 'X-DashScope-Async: enable' \
--header "Authorization: Bearer $DASHSCOPE_API_KEY" \
--header 'Content-Type: application/json' \
--data '{
    "model": "wanx-style-repaint-v1",
    "input": {
        "image_url": "https://vigen-video.oss-cn-shanghai.aliyuncs.com/demo_image/image_demo_input.png",
        "style_index": 3
    }
}'
响应示例

task_id查询有效期为24小时。
{
    "output": {
        "task_status": "PENDING",
        "task_id": "0385dc79-5ff8-4d82-bcb6-xxxxxx"
    },
    "request_id": "4909100c-7b5a-9f92-bfe5-xxxxxx"
}
步骤2：查询任务结果
使用 task_id 轮询任务状态，直至完成并获取生成的图像URL。

请求示例

将{task_id}完整替换为上一步接口返回的task_id的值。
curl -X GET https://dashscope.aliyuncs.com/api/v1/tasks/{task_id} \
--header "Authorization: Bearer $DASHSCOPE_API_KEY"
响应示例
{
    "request_id": "f7fee4f1-1f68-9f17-85df-xxxxx",
    "output": {
        "task_id": "316c7af0-e91f-476f-99bd-xxxxxx",
        "task_status": "SUCCEEDED",
        "submit_time": "2025-08-12 10:55:43.768",
        "scheduled_time": "2025-08-12 10:55:43.799",
        "end_time": "2025-08-12 10:55:48",
        "error_message": "Success",
        "start_time": "2025-08-12 10:55:43",
        "style_index": 0,
        "error_code": 0,
        "results": [
            {
                "url": "http://oss.aliyuncs.com/xxx/abc.jpg"
            }
        ]
    },
    "usage": {
        "image_count": 1
    }
}