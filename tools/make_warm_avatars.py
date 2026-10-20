from pathlib import Path
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
OUT = Path('output/warm-avatars')
OUT.mkdir(parents=True, exist_ok=True)

def rgb(h):
    return tuple(bytes.fromhex(h.lstrip('#')))

def blend(a, b, t):
    return tuple(int(a[i] * (1-t) + b[i] * t) for i in range(3))

def backdrop(top, bottom, glow):
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    t = (0.65*x/SIZE + 0.35*y/SIZE)
    base = np.zeros((SIZE, SIZE, 3), dtype=np.float32)
    a, b, g = np.array(rgb(top)), np.array(rgb(bottom)), np.array(rgb(glow))
    base[:] = a[None,None,:] * (1-t[:,:,None]) + b[None,None,:] * t[:,:,None]
    halo = np.exp(-(((x-780)/540)**2 + ((y-245)/530)**2)*2.0) * 0.28
    base = base * (1-halo[:,:,None]) + g[None,None,:] * halo[:,:,None]
    return Image.fromarray(np.uint8(np.clip(base,0,255)), 'RGB').convert('RGBA')

def gradient(c1, c2, c3):
    y, x = np.mgrid[0:SIZE, 0:SIZE]
    t = np.clip((x*0.58+y*0.42)/SIZE,0,1)
    a,b,c = [np.array(rgb(v), dtype=np.float32) for v in (c1,c2,c3)]
    left = a[None,None,:]*(1-2*np.minimum(t,.5)[:,:,None])+b[None,None,:]*(2*np.minimum(t,.5)[:,:,None])
    right = b[None,None,:]*(2-2*np.maximum(t,.5)[:,:,None])+c[None,None,:]*(2*np.maximum(t,.5)[:,:,None]-1)
    col = np.where((t<.5)[:,:,None],left,right)
    light = 0.11*np.exp(-(((x-330)/500)**2+((y-260)/410)**2)*2)
    col = col*(1-light[:,:,None])+255*light[:,:,None]
    return Image.fromarray(np.uint8(np.clip(col,0,255)),'RGB').convert('RGBA')

def layer(base, mask, colors, shadow=35):
    blur = mask.filter(ImageFilter.GaussianBlur(shadow))
    sh = Image.new('RGBA', (SIZE,SIZE), (0,0,0,0))
    amber = Image.new('RGBA',(SIZE,SIZE),(255,102,40,105))
    sh.paste(amber,(0,0),blur)
    base.alpha_composite(sh)
    ink=gradient(*colors)
    ink.putalpha(mask)
    base.alpha_composite(ink)

def mask():
    return Image.new('L',(SIZE,SIZE),0)

def roundrect(m,box,r=60,fill=255):
    ImageDraw.Draw(m).rounded_rectangle(box,radius=r,fill=fill)

def ellipse(m,box,fill=255):
    ImageDraw.Draw(m).ellipse(box,fill=fill)

def smooth_line(m,pts,width,fill=255):
    d=ImageDraw.Draw(m)
    d.line(pts,fill=fill,width=width,joint='curve')
    for x,y in (pts[0],pts[-1]): d.ellipse((x-width/2,y-width/2,x+width/2,y+width/2),fill=fill)

def bez(p0,p1,p2,p3,n=70):
    return [(int((1-t)**3*p0[0]+3*(1-t)**2*t*p1[0]+3*(1-t)*t*t*p2[0]+t**3*p3[0]),
             int((1-t)**3*p0[1]+3*(1-t)**2*t*p1[1]+3*(1-t)*t*t*p2[1]+t**3*p3[1])) for t in np.linspace(0,1,n)]

def sparkle(base,x,y,s=28,color='#FFE3A7'):
    m=mask(); d=ImageDraw.Draw(m)
    d.polygon([(x,y-s),(x+s*.26,y-s*.26),(x+s,y),(x+s*.26,y+s*.26),(x,y+s),(x-s*.26,y+s*.26),(x-s,y),(x-s*.26,y-s*.26)],fill=255)
    k=Image.new('RGBA',(SIZE,SIZE),rgb(color)+(0,)); k.putalpha(m); base.alpha_composite(k)

def finish(im,name):
    # Output is square with a transparent corner outside the app-icon silhouette.
    outer=mask(); roundrect(outer,(32,32,992,992),220)
    im.putalpha(outer)
    im.save(OUT / f'{name}.png',optimize=True)
    return im

images=[]
palette=('#F35957','#FFAC56','#FFE283')

# 1: orbiting lens — an open-ring lens and orbiting dot.
im=backdrop('#231222','#4A1D2D','#87354A')
m=mask(); ellipse(m,(232,232,792,792)); ellipse(m,(335,335,689,689),0)
layer(im,m,palette)
m=mask(); ellipse(m,(630,176,788,334)); layer(im,m,('#FFAD58','#FFD57C','#FFF1B0'),16)
m=mask(); ellipse(m,(431,431,593,593)); layer(im,m,('#FF7B60','#FFBC72','#FFE49D'),18)
sparkle(im,273,690,24)
images.append(finish(im,'01-orbit-lens'))

# 2: four soft petals framing a video aperture.
im=backdrop('#251522','#5A2432','#93424E')
m=mask(); d=ImageDraw.Draw(m)
d.rounded_rectangle((412,171,612,440),radius=100,fill=255)
d.rounded_rectangle((412,584,612,853),radius=100,fill=255)
d.rounded_rectangle((171,412,440,612),radius=100,fill=255)
d.rounded_rectangle((584,412,853,612),radius=100,fill=255)
layer(im,m,('#F46765','#FFAE69','#FFDB82'))
m=mask(); ellipse(m,(342,342,682,682)); layer(im,m,('#FE8C68','#FFC17B','#FFE6A1'),15)
m=mask(); ImageDraw.Draw(m).polygon([(473,412),(473,612),(636,512)],fill=255)
hole=Image.new('RGBA',(SIZE,SIZE),(53,21,36,255)); hole.putalpha(m); im.alpha_composite(hole)
images.append(finish(im,'02-bloom-play'))

# 3: layered screen windows, with an offset glowing media tile.
im=backdrop('#24151D','#553025','#A95633')
m=mask(); roundrect(m,(248,232,702,705),95); layer(im,m,('#EE785A','#FFB468','#FFD887'))
m=mask(); roundrect(m,(330,307,790,783),95); layer(im,m,('#F75B58','#FFA962','#FFE18A'),18)
m=mask(); roundrect(m,(387,368,729,722),65)
cut=Image.new('RGBA',(SIZE,SIZE),(55,24,33,255)); cut.putalpha(m); im.alpha_composite(cut)
m=mask(); ImageDraw.Draw(m).polygon([(487,444),(487,647),(651,545)],fill=255)
layer(im,m,('#FF9A62','#FFD17C','#FFF0AC'),14)
images.append(finish(im,'03-layered-screen'))

# 4: sunrise over flowing video waves.
im=backdrop('#281722','#603026','#B45636')
m=mask(); ellipse(m,(351,223,673,545)); layer(im,m,('#FB7157','#FFB65C','#FFE17D'))
m=mask(); smooth_line(m,bez((233,605),(418,395),(563,803),(800,524)),102)
layer(im,m,('#EF5C59','#FFAD60','#FFD77A'))
m=mask(); smooth_line(m,bez((251,754),(415,577),(612,899),(777,697)),66)
layer(im,m,('#F37463','#FFC373','#FFEA9A'),16)
sparkle(im,763,305,37)
images.append(finish(im,'04-sunset-flow'))

# 5: winding spark with a distinctive warm spiral motion.
im=backdrop('#271422','#512032','#943F40')
m=mask(); smooth_line(m,bez((337,300),(444,205),(676,257),(738,420))+bez((738,420),(825,666),(607,792),(429,704)),116)
layer(im,m,('#F65C5F','#FFAB62','#FFE38B'))
m=mask(); smooth_line(m,bez((430,699),(299,655),(300,475),(419,409))+bez((419,409),(560,333),(656,421),(608,540)),94)
layer(im,m,('#EE646A','#FF9E65','#FFDB82'),18)
m=mask(); ellipse(m,(535,470,648,583)); layer(im,m,('#FFAF6A','#FFD584','#FFF0AA'),12)
sparkle(im,730,221,38)
images.append(finish(im,'05-spiral-spark'))

thumb=Image.new('RGB',(5*300,355),'#FFF7EF')
from PIL import ImageFont
d=ImageDraw.Draw(thumb)
labels=['环绕镜头','绽放播放','叠层画框','日落流线','旋动火花']
for i,(img,label) in enumerate(zip(images,labels)):
    thumb.paste(img.resize((270,270),Image.Resampling.LANCZOS),(i*300+15,15),img.resize((270,270),Image.Resampling.LANCZOS))
    try: font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',22)
    except OSError: font=ImageFont.load_default()
    box=d.textbbox((0,0),label,font=font)
    d.text((i*300+150-(box[2]-box[0])/2,305),label,fill='#533023',font=font)
thumb.save(OUT/'preview-five.png',optimize=True)
print('Created:',*[str(p) for p in OUT.glob('*.png')],sep='\n')
