# 场景多视图提示词备份（2026-07-15）

替换为「参考场景锁定模式」九宫格模板前，`multi-view` 模式使用的提示词如下。

```text
[STYLE LOCK — 场景多视图,适用对象:scene]
{buildStyleLock(styleSpec, "scene")}

[任务] 基于图1生成同一个场景的四方向参考图,不是四个新场景。图1是正面基线真值。
[地点] {sceneSlug}
[具体地点] {sceneLocation，存在时}
[时段] {sceneTimeOfDay，存在时}
[场景语义] {sceneAction，存在时}

[画布] 2048×2048, 2×2 等大面板,顺序固定为:左上正面、右上左侧、左下背面、右下右侧。不要在图中绘制文字、编号或标签。

[生成顺序与参考关系] 严格按以下顺序理解并构图,四格共享同一个空间坐标系:
1. 正面(左上):直接参考图1,建立场景布局、建筑结构、门窗、道路、家具、树木、灯具和其他关键锚点。
2. 左侧(右上):镜头从正面向左绕场景旋转90°;重点参考正面图左侧可见的墙面和物体,展示它们的侧面,保持与正面相邻关系。
3. 背面(左下):镜头从左侧继续绕到场景背面,做镜头反打;参考左侧图已经揭示的结构和正面图的深度锚点,展示同一空间及物体背面,不是正面镜像。
4. 右侧(右下):镜头从背面继续绕到右侧;同时参考背面图与正面图右侧可见的结构,展示与左右两侧、正面和背面都能闭合的同一空间。

[一致性规则]
- 四格必须是同一地点、同一时段、同一天气、同一光线和同一视觉风格。
- 固定物体的数量、材质、颜色、尺寸和空间位置关系保持一致;不同视角只改变可见面和透视。
- 只使用图1已有或由其结构必然推出的内容;看不见的细节保守补全,不得添加新的建筑、家具、门窗或装饰。
- 画面必须有真实空间深度;不得把四格做成复制、镜像、平移或四个无关背景。
- 场景中绝对不出现角色、人物、动物、路人、人形、剪影、手或身体局部;这是纯环境参考图。

[提交前检查] 顺序为正面→左侧→背面→右侧;四格能沿同一空间绕行闭合;无人物;无新增物体;无文字水印。
```

原负面提示词：

```text
people, person, character, human, animal, animal silhouette, figure, crowd, bystander, shadow person, hand, body part, four unrelated scenes, different location, different room, different architecture, different furniture layout, front copy, mirrored front, flipped image, duplicated panel, same angle in all panels, flat 2D collage, left and right showing the same wall, back view showing the front, missing rear structure, impossible perspective, invented building, invented door, invented window, invented furniture, invented decoration, extra objects, removed objects, different time of day, different weather, different lighting, different color palette, style drift, text, label, caption, number, arrow, logo, watermark, grid lines, visible panel border, top-down view, isometric view, fisheye distortion, low quality, blurry, pixelated, jpeg artifacts
```
