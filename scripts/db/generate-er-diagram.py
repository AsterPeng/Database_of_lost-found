"""P8 生成课程报告用的核心 ER 图（Pillow）。"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[2] / "docs" / "database" / "assets" / "er-diagram.png"
FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
if not Path(FONT_PATH).exists():
    FONT_PATH = "C:/Windows/Fonts/simhei.ttf"

WIDTH, HEIGHT = 1800, 1250
image = Image.new("RGB", (WIDTH, HEIGHT), "#fbfaf7")
draw = ImageDraw.Draw(image)

def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)

F_TITLE = font(34)
F_BOX = font(22)
F_ATTR = font(15)
F_LABEL = font(16)
F_NOTE = font(15)

def box(x1, y1, x2, y2, title, attrs, fill="#e8f1fb", outline="#2f5d8a"):
    draw.rounded_rectangle((x1, y1, x2, y2), radius=14, fill=fill, outline=outline, width=3)
    draw.text((x1 + 16, y1 + 12), title, font=F_BOX, fill="#12314f")
    y = y1 + 48
    for attr in attrs:
        draw.text((x1 + 18, y), attr, font=F_ATTR, fill="#33475b")
        y += 24

def line(x1, y1, x2, y2, label="", dashed=False):
    if dashed:
        # 简单虚线
        steps = 18
        for i in range(steps):
            if i % 2:
                continue
            ax = x1 + (x2 - x1) * i / steps
            ay = y1 + (y2 - y1) * i / steps
            bx = x1 + (x2 - x1) * (i + 1) / steps
            by = y1 + (y2 - y1) * (i + 1) / steps
            draw.line((ax, ay, bx, by), fill="#6b7d8f", width=2)
    else:
        draw.line((x1, y1, x2, y2), fill="#6b7d8f", width=3)
    # 箭头
    draw.ellipse((x2 - 5, y2 - 5, x2 + 5, y2 + 5), fill="#6b7d8f")
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        bbox = draw.textbbox((0, 0), label, font=F_LABEL)
        w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.rounded_rectangle((mx - w / 2 - 6, my - h / 2 - 4, mx + w / 2 + 6, my + h / 2 + 6),
                               radius=5, fill="#fbfaf7")
        draw.text((mx - w / 2, my - h / 2 - 2), label, font=F_LABEL, fill="#243b53")

draw.text((60, 32), "校园智能失物招领平台 · 核心 ER 图", font=F_TITLE, fill="#1d2b3a")
draw.text((60, 78), "完整 17 个实体、23 个外键与业务规则见 01-概念设计.md", font=F_NOTE, fill="#5b6b7a")

box(60, 150, 390, 330, "USERS 用户",
    ["id PK", "email UQ", "role / status", "department", "phone_encrypted"], "#e8f1fb")
box(520, 150, 830, 280, "CATEGORIES 类别",
    ["id PK", "name UQ", "enabled"], "#eaf6ea", "#2f6b3a")
box(700, 370, 1100, 610, "POSTS 帖子",
    ["id PK", "author_id FK", "category_id FK", "type / status", "deleted_at / taken_down_at",
     "archived_at"], "#e8f1fb")
box(1210, 370, 1570, 530, "POST_IMAGES 配图",
    ["id PK", "post_id FK", "path", "sort_order"], "#fdf2e3", "#8a5a1f")
box(700, 690, 1100, 860, "MATCHES 匹配",
    ["id PK", "lost_post_id FK", "found_post_id FK", "score", "feedback"], "#f3e8fb", "#5b3a7a")
box(370, 690, 700, 900, "CLAIMS 认领",
    ["id PK", "post_id FK", "claimant_id FK", "status", "escalate_at", "reviewed_by_id FK"], "#e8f1fb")
box(60, 690, 330, 850, "HANDOVERS 交接",
    ["id PK", "claim_id FK/UQ", "meet_at", "completed_at"], "#eaf6ea", "#2f6b3a")
box(60, 930, 390, 1110, "CONTACT_GRANTS 授权",
    ["id PK", "claim_id FK", "grantor_id FK", "grantee_id FK", "revoked_at"], "#fdf2e3", "#8a5a1f")
box(1210, 690, 1570, 870, "NOTIFICATIONS 通知",
    ["id PK", "user_id FK", "type", "deliver_at", "read_at"], "#f3e8fb", "#5b3a7a")
box(1210, 930, 1570, 1100, "AUDIT_LOGS 审计",
    ["id PK", "operator_id FK", "action", "target_type", "target_id"], "#fdf2e3", "#8a5a1f")

line(390, 240, 700, 430, "1:N 发布")
line(675, 240, 760, 370, "1:N 分类")
line(1100, 460, 1210, 450, "1:N 配图")
line(900, 610, 900, 690, "1:N 失物/拾物")
line(700, 470, 700, 690, "1:N 被认领")
line(330, 740, 370, 760, "1:1 交接")
line(535, 900, 535, 930, "1:N 授权")

draw.rounded_rectangle((60, 1150, 1740, 1210), radius=8, fill="#fff7e6", outline="#d8b56a")
draw.text((80, 1162),
          "说明：图中为核心实体与主要关系；USERS→NOTIFICATIONS、USERS→AUDIT_LOGS 等关系为清晰起见未连线。"
          "SESSIONS、POST_EMBEDDINGS、EMBEDDING_TASKS、NOTIFICATION_PREFERENCES、REPORTS、ANNOUNCEMENTS、"
          "APP_CONFIGS 等完整实体见概念设计文档。",
          font=F_NOTE, fill="#5c4a1f")

OUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUT, "PNG")
print(f"ER 图已生成：{OUT}")