## 问题

分镜生成时调用 `pixflow/gpt-image-2` 报 `400: failed to parse multipart form`。

服务端日志确认:
```
[pixflow→] model=gpt-image-2 endpoint=/v1/images/edits refs=3 ...
[pixflow×] status=400 body={"error":{"message":"failed to parse multipart form","type":"upstream_error"}}
```

## 根因

`src/lib/pixflow.functions.ts` 中,gpt-image-* 走 `/v1/images/edits` 时用的是 JSON body(`images[].image_url`)。Pixflow `/v1/images/edits` 上游只接受 **multipart/form-data 二进制文件**(参见 `docs/image2.md`:`-F "image[]=@ref1.png"`),所以解析失败直接 400。

## 修复方案

只改一个函数:`callPixflowImage` 中 gpt-image-* 且有参考图的分支。

1. 把每个 `referenceImages[]` URL `fetch` 成 `Blob`(复用现有 20s 超时),失败则跳过该参考图。
2. 用 `FormData` 组装请求:
   - `model`, `prompt`, `n`, `size`, `quality`, `response_format=url`
   - 对每张图 `form.append('image[]', blob, 'refN.png')`(按 Content-Type 推断扩展名,默认 png)
3. 不再设置 `Content-Type` header,让 fetch 自动写入 boundary。
4. 若全部参考图下载失败,退回到 `/v1/images/generations`(纯 T2I),并在日志里 warn。
5. 保留现有的 502/503/504/524 一次重试 + 指数退避;保留无参考图走 `/v1/images/generations` JSON 分支不变;保留 Gemini Native 分支不变。

## 涉及文件

- `src/lib/pixflow.functions.ts` —— 仅修改 OpenAI 兼容 edits 分支(约 30 行内)。

## 验证

修复后用一次真实分镜 I2I 请求触发,确认服务端日志出现 `[pixflow✓] endpoint=/v1/images/edits images=1`,前端不再报 400。
