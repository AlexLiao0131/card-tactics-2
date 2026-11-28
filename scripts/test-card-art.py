#!/usr/bin/env python3
"""Self-contained build/runtime tests; no downloaded artwork or live site needed."""
import importlib.util
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('build_card_art', ROOT/'scripts/build-card-art.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
ART = 'assets/images/cards/heroes'

def fixture(path, seed, size=(190, 285)):
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    # High frequency source colors, exact gradient alpha, and transparent edges.
    rgba = bytearray(rng.randbytes(size[0]*size[1]*4))
    for y in range(size[1]):
        for x in range(size[0]):
            rgba[(y*size[0]+x)*4+3] = 0 if x<3 else min(255, x*255//max(1,size[0]-10))
    Image.frombytes('RGBA', size, bytes(rgba)).save(path, format='PNG')

class CardArtTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        base = Path(cls.tmp.name)
        cls.src = base/'original'; cls.src.mkdir()
        for path in ['js/visual-database.js','js/card-hand-ui.js','css/hero-card.css','css/unit-hud.css']:
            (cls.src/path).parent.mkdir(parents=True,exist_ok=True)
            shutil.copy2(ROOT/path,cls.src/path)
        fixture(cls.src/ART/'viola.PNG', 1, (540, 810))
        fixture(cls.src/ART/'livia.png', 2)
        fixture(cls.src/ART/'livia.PNG', 3)
        fixture(cls.src/ART/'hero-frame.png', 4, (120, 180))
        fixture(cls.src/ART/'hero-background.png', 5, (120, 180))
        shutil.copy2(cls.src/ART/'livia.png', cls.src/ART/'colin.png')
        cls.originals = {p.relative_to(cls.src):p.read_bytes() for p in cls.src.rglob('*') if p.is_file()}
        cls.site = base/'site';shutil.copytree(cls.src,cls.site)
        cls.cache = base/'cache'
        cls.stats = module.build(cls.site,cls.cache)
        cls.report = json.loads((cls.site/module.OUTPUT/'report.json').read_text())
        cls.images = {i['source']:i for i in cls.report['images']}
    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()
    def test_original_pngs_and_source_are_unchanged(self):
        for path, data in self.originals.items():
            self.assertEqual((self.src/path).read_bytes(),data)
            if path.suffix.lower()=='.png':
                self.assertEqual((self.site/path).read_bytes(),data)
        self.assertEqual(self.stats['caseConflicts'],[f'{ART}/livia.png'])
    def test_dimensions_alpha_and_bytes(self):
        info=self.images[f'{ART}/viola.PNG']
        with Image.open(self.src/ART/'viola.PNG') as source:
            for tier,limit in [('hud',(128,192)),('card',(512,768)),('preview',source.size)]:
                variant=info[tier]
                with Image.open(self.site/variant['url']) as result:
                    expected=source.convert('RGBA');expected.thumbnail(limit,Image.Resampling.LANCZOS)
                    self.assertEqual(result.size,expected.size)
                    self.assertEqual(result.convert('RGBA').getchannel('A').tobytes(),expected.getchannel('A').tobytes())
                self.assertLess(variant['bytes'],info['sourceBytes'])
    def test_shared_sources_deduplicate_and_frame_geometry(self):
        for tier in ('hud','card','preview'):
            self.assertEqual(self.images[f'{ART}/livia.png'][tier]['url'],self.images[f'{ART}/colin.png'][tier]['url'])
        info=self.images[f'{ART}/hero-frame.png']['preview']
        path=self.site/info['url'].split('?')[0]
        with Image.open(path) as derived, Image.open(self.src/ART/'hero-frame.png') as original:
            self.assertEqual(derived.convert('RGBA').tobytes(),original.convert('RGBA').tobytes())
        for css in ('hero-card.css','unit-hud.css'):
            self.assertIn("../"+info['url'], (self.site/'css'/css).read_text())
    def test_manifest_runtime_and_fallback(self):
        code=r'''
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const [site,source]=process.argv.slice(1);
const events={};globalThis.document={baseURI:'https://example.test/card-tactics-2/index.html',addEventListener:(name,fn)=>events[name]=fn};
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(await readFile(file)).toString('base64'));
const {VisualDatabase:v}=await load(site+'/js/visual-database.js');
const base='assets/images/cards/heroes/';
const hud=v.characterHudPortrait('viola'),card=v.artworkUrl(base+'viola.png','card'),preview=v.artworkUrl(base+'viola.png','preview');
assert(hud.endsWith('.webp'));assert(card.endsWith('.webp'));assert(preview.endsWith('.webp'));
assert.equal(new Set([hud,card,preview]).size,3);
assert.equal(card,v.artworkUrl(base+'viola.PNG','card'));
assert.notEqual(v.artworkUrl(base+'livia.png'),v.artworkUrl(base+'livia.PNG'));
assert.equal(v.artworkUrl('https://other.test/'+base+'viola.png'), 'https://other.test/'+base+'viola.png');
assert.equal(v.artworkUrl(base+'new.png'),base+'new.png');
let stopped=0;const image={tagName:'IMG',src:new URL(card,document.baseURI).href,dataset:{}};
events.error({target:image,stopImmediatePropagation:()=>stopped++});assert(image.src.includes('viola.PNG?art='));assert.equal(stopped,1);
const {heroCardFace}=await load(site+'/js/card-hand-ui.js');
const hero={id:'viola_test',characterId:'viola',type:'CHARACTER',unitType:'HERO',name:'test',cost:5};
assert(heroCardFace(hero,{variant:'hand'}).includes(`src="${card}"`));
assert(heroCardFace(hero,{variant:'collection'}).includes('loading="lazy"'));
assert(heroCardFace(hero,{variant:'hand'}).includes('loading="eager"'));
assert(heroCardFace(hero,{variant:'preview'}).includes(`src="${preview}"`));
const raw=(await load(source+'/js/visual-database.js')).VisualDatabase;
assert.equal(raw.characterHudPortrait('viola'),base+'viola.png');
assert.equal(raw.artworkUrl(base+'viola.png'),base+'viola.png');
'''
        subprocess.run(['node','--input-type=module','-e',code,str(self.site),str(self.src)],check=True)
    def test_cache_reuse_and_changed_source_invalidates_url(self):
        second=Path(self.tmp.name)/'second';shutil.copytree(self.src,second)
        before=self.images[f'{ART}/viola.PNG']['card']['url']
        fixture(second/ART/'viola.PNG',6,(540,810))
        stats=module.build(second,self.cache)
        after=json.loads((second/module.OUTPUT/'report.json').read_text())
        new=next(i for i in after['images'] if i['source']==f'{ART}/viola.PNG')
        self.assertNotEqual(before,new['card']['url'])
        self.assertGreater(stats['cacheHits'],0)
        with self.assertRaisesRegex(ValueError,'manifest marker'):
            module.build(second,self.cache)
    def test_git_worktree_rejected(self):
        path=Path(self.tmp.name)/'git';path.mkdir();(path/'.git').mkdir()
        with self.assertRaisesRegex(ValueError,'Git working tree'):
            module.build(path)

if __name__=='__main__':
    unittest.main(verbosity=2)
