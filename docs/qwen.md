千问-文生图模型接口
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
--header 'Content-Type: application/json' \
--header "Authorization: Bearer $DASHSCOPE_API_KEY" \
--data '{
    "model": "qwen-image-2.0-pro",
    "input": {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "text": "冬日北京的都市街景，青灰瓦顶、朱红色外墙的两间相邻中式商铺比肩而立，檐下悬挂印有剪纸马的暖光灯笼，在阴天漫射光中投下柔和光晕，映照湿润鹅卵石路面泛起细腻反光。左侧为书法店：靛蓝色老旧的牌匾上以遒劲行书刻着“文字渲染”。店门口的玻璃上挂着一幅字，自上而下，用田英章硬笔写着“专业幻灯片 中英文海报 高级信息图”，落款印章为“1k token”朱砂印。店内的墙上，可以模糊的辨认有三幅竖排的书法作品，第一幅写着“阿里巴巴”，第二幅写着“通义千问”，第三幅写着“图像生成”。一位白发苍苍的老人背对着镜头观赏。右侧为花店，牌匾上以鲜花做成文字“真实质感”；店内多层花架陈列红玫瑰、粉洋牡丹和绿植，门上贴了一个圆形花边标识，标识上写着“2k resolution”，门口摆放了一个彩色霓虹灯，上面写着“细腻刻画 人物 自然 建筑”。两家店中间堆放了一个雪人，举了一老式小黑板，上面用粉笔字写着“Qwen-Image-2.0 正式发布”。街道左侧，年轻情侣依偎在一起，女孩是瘦脸，身穿米白色羊绒大衣，肉色光腿神器。女孩举着心形透明气球，气球印有白色的字：“生图编辑二合一”。里面有一个毛茸茸的卡皮巴拉玩偶。男孩身着剪裁合体的深灰色呢子外套，内搭浅色高领毛衣。街道右侧，一个后背上写着“更小模型，更快速度”的骑手疾驰而过。整条街光影交织、动静相宜。"
                    }
                ]
            }
        ]
    },
    "parameters": {
        "negative_prompt": "低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感。构图混乱。文字模糊，扭曲。",
        "prompt_extend": true,
        "watermark": false,
        "size": "2048*2048"
    }
}'
成功返回
{
    "output": {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": [
                        {
                            "image": "https://dashscope-result-sh.oss-cn-shanghai.aliyuncs.com/xxx.png?Expires=xxx"
                        }
                    ],
                    "role": "assistant"
                }
            }
        ]
    },
    "usage": {
        "height": 2048,
        "image_count": 1,
        "width": 2048
    },
    "request_id": "d0250a3d-b07f-49e1-bdc8-6793f4929xxx"
}
千问单图编辑接口
curl --location 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation' \
--header 'Content-Type: application/json' \
--header "Authorization: Bearer $DASHSCOPE_API_KEY" \
--data '{
    "model": "qwen-image-2.0-pro",
    "input": {
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "image": "https://help-static-aliyun-doc.aliyuncs.com/file-manage-files/zh-CN/20260310/jiydyi/image+%2818%29-2026-03-10-16-39-59.webp"
                    },
                    {
                        "text": "在画面右下角石板路旁、靠近树干根部的位置，以浅灰墨色手写体题写一首七言绝句，字体为行楷风格，笔触自然流畅、略带飞白，大小适中（约占画面高度1/10），与整体水墨淡雅氛围协调。诗文内容为：“青石桥畔柳风轻， 素手拈花闭目听。 一水碧痕浮旧梦， 半篙烟雨入空舲。”诗句横向排列，四句分两行书写（前两句一行，后两句一行），末句“舲”字右下角钤一枚朱红小印，印文为“江南”二字篆书，尺寸约等于单字高度的1/3。"
                    }
                ]
            }
        ]
    },
    "parameters": {
        "n": 1,
        "negative_prompt": " ",
        "prompt_extend": true,
        "watermark": false,
        "size": "2048*2048"
    }
}'
成功返回
{
    "output": {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": [
                        {
                            "image": "https://dashscope-result-sz.oss-cn-shenzhen.aliyuncs.com/xxx.png?Expires=xxx"
                        }
                    ],
                    "role": "assistant"
                }
            }
        ]
    },
    "usage": {
        "height": 2048,
        "image_count": 1,
        "width": 2048
    },
    "request_id": "571ae02f-5c9d-436c-83c2-f221e6df0xxx"
}
通过兼容 OpenAI 格式的 Chat API接口
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
-H "Authorization: Bearer $DASHSCOPE_API_KEY" \
-H "Content-Type: application/json" \
-d '{
    "model": "qwen-plus",
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
成功返回
{
    "choices": [
        {
            "message": {
                "role": "assistant",
                "content": "我是阿里云开发的一款超大规模语言模型，我叫千问。"
            },
            "finish_reason": "stop",
            "index": 0,
            "logprobs": null
        }
    ],
    "object": "chat.completion",
    "usage": {
        "prompt_tokens": 3019,
        "completion_tokens": 104,
        "total_tokens": 3123,
        "prompt_tokens_details": {
            "cached_tokens": 2048
        }
    },
    "created": 1735120033,
    "system_fingerprint": null,
    "model": "qwen-plus",
    "id": "chatcmpl-6ada9ed2-7f33-9de2-8bb0-78bd4035025a"
}
