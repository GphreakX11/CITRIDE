"""Real disposable-store Part B browser exercise. No production, resets, inferred passes.
Uses existing built assets; only permits the explicit case-create POSTs during setup.
"""
import json,mimetypes,os,re,sys,traceback
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qs
from urllib.request import urlopen
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2];OUT=Path(sys.argv[1]);DIST=ROOT/'frontend/dist'
TXCC=os.environ['PART_B_TXCC_ORIGIN'];THIRD=os.environ['PART_B_THIRD_ORIGIN'];LARGE=os.environ['PART_B_LARGE_ORIGIN']
LARGE_METADATA=Path(os.environ['PART_B_LARGE_METADATA'])
def validate_customer_receipt(receipt):
 if not isinstance(receipt,dict):raise ValueError('Customer receipt must be an object')
 if 'error' in receipt or receipt.get('traceback'):
  raise ValueError('Customer receipt producer failed: '+str(receipt.get('error') or receipt.get('traceback') or 'unknown producer error'))
 if not isinstance(receipt.get('incident'),str) or not receipt['incident'].strip():raise ValueError('Customer receipt missing valid incident')
 if type(receipt.get('pass')) is not bool or not isinstance(receipt.get('screens'),list):raise ValueError('Customer receipt malformed pass/screens structure')
 if receipt['pass'] is not True:raise ValueError('Customer separation producer failed')
 return receipt
def customer_search_identity(visible_ids,owned_ids,foreign_id):
 """A substring hit on an owned ID is not a foreign incident being returned."""
 foreign=[identifier for identifier in visible_ids if identifier==foreign_id or identifier not in owned_ids]
 return {'visibleIncidentIds':visible_ids,'foreignIncidentIds':foreign,'ownedOnly':not foreign and len(set(visible_ids))==len(visible_ids)}
customer=validate_customer_receipt(json.loads((OUT/'check-2-customer.json').read_text()))
VIEWS=['command','cop','cyber','consequence','coordination','uctf','case-file','entity-profile']
COMMAND=['command','cop','cyber','consequence','uctf','leadership','federation']
report={'candidateBeforeCommit':sys.argv[2],'matrix':[],'analyst':[],'cases':[],'history':[],'errors':[],'blocked':[],'coverageGaps':[]}
def get(origin,path):return json.load(urlopen(origin+path,timeout=20))
def ids(x):
 if isinstance(x,dict):return ({x['id']} if isinstance(x.get('id'),str) else set()).union(*(ids(v) for v in x.values()))
 if isinstance(x,list):return set().union(*(ids(v) for v in x))
 return set()
def url(origin,mode,view,incident,case=None,entity=None,sector=None):
 d={'mode':mode,'view':view,'incident':incident,'incidentId':incident}
 if case:d['case']=case
 if entity:d['entity']=entity
 if sector:d['sector']=sector
 return origin+'/?'+urlencode(d)
with sync_playwright() as pw:
 browser=pw.chromium.launch();contexts=[]
 def page_for(origin):
  ctx=browser.new_context();contexts.append(ctx);state={'allowCreate':False,'writes':[]}
  def guard(route):
   req=route.request;p=urlsplit(req.url)
   allowed=req.url.startswith(origin+'/') and (req.method in {'GET','HEAD','OPTIONS'} or (state['allowCreate'] and req.method=='POST' and p.path=='/v1/command/incidents'))
   if not allowed:report['blocked'].append({'url':req.url,'method':req.method});route.abort();return
   if req.method=='POST':state['writes'].append({'path':p.path,'body':req.post_data_json})
   if not p.path.startswith(('/v1/','/health')):
    asset=DIST/('index.html' if p.path=='/' else p.path.lstrip('/'))
    if asset.resolve().is_relative_to(DIST.resolve()) and asset.is_file():route.fulfill(path=str(asset),content_type=mimetypes.guess_type(asset)[0] or 'application/octet-stream');return
   route.continue_()
  ctx.route('**/*',guard);page=ctx.new_page();page.on('pageerror',lambda e:report['errors'].append({'origin':origin,'error':str(e)}));return page,state
 def visit(page,address):
  page.goto(address,wait_until='networkidle',timeout=20000)
 def snapshot(page):
  return {'url':page.url,'query':{k:v[-1] for k,v in parse_qs(urlsplit(page.url).query).items()},'renderedView':page.locator('[data-view]').first.get_attribute('data-view'),'mode':page.locator('[data-mode]').first.get_attribute('data-mode'),'empty':page.locator('main').inner_text().count('No incident selected'),'alerts':page.locator('[data-alert-id]').count()}
 def inventory(page):
  return page.locator('main button,main a').evaluate_all("els=>els.filter(e=>e.getBoundingClientRect().width&&!e.disabled).map(e=>({label:e.innerText.trim(),title:e.getAttribute('title'),href:e.getAttribute('href'),className:e.className,border:getComputedStyle(e).borderStyle})).filter(e=>/in Analyst|↗/.test(e.label))")
 def audit_commands(page,origin,incident,case,phase):
  for view in COMMAND:
   source=url(origin,'command',view,incident,case)
   try:
    visit(page,source)
    # Expand nonmutating detail disclosures to reveal asset links.
    page.locator('main details').evaluate_all('els=>els.forEach(e=>e.open=true)')
    links=inventory(page)
    report.setdefault('sourceVisits',[]).append({'origin':origin,'incident':incident,'phase':phase,'view':view,'rendered':snapshot(page)['renderedView'],'discovered':len(links)})
    for link in {json.dumps(l,sort_keys=True):l for l in links}.values():
     row={'origin':origin,'incident':incident,'sourceView':view,'phase':phase,'source':link,'followed':False};report['matrix'].append(row)
     try:
      visit(page,source);page.locator('main details').evaluate_all('els=>els.forEach(e=>e.open=true)')
      target=page.get_by_role('button',name=link['label'],exact=True).first
      if not target.count():target=page.get_by_role('link',name=link['label'],exact=True).first
      target.click(timeout=3000);row['followed']=True;page.wait_for_timeout(100);page.wait_for_load_state('networkidle')
      row['landing']=snapshot(page);q=row['landing']['query'];row['stylePass']=link['border']=='dashed' and 'in Analyst' in link['label'] and link['label'].endswith('↗')
      row['incidentPass']=q.get('incidentId',q.get('incident'))==incident;row['modePass']=q.get('mode')=='analyst';row['casePass']=not case or q.get('case')==case
      row['noEmptyPass']=row['landing']['empty']==0
     except Exception as e:row['error']=str(e)
   except Exception as e:report['errors'].append({'source':source,'error':str(e)})
 def analyst_views(page,origin,incident,case,entity):
  for view in VIEWS:
   row={'origin':origin,'incident':incident,'case':case,'requested':view};report['analyst'].append(row)
   try:
    visit(page,url(origin,'analyst',view,incident,case,entity));row['landing']=snapshot(page)
    row['viewPass']=row['landing']['renderedView']==view;row['casePass']=row['landing']['query'].get('case')==case
    row['visibleErrors']=page.locator('[role=alert]').all_text_contents();row['navigation']=page.locator('main button,main a').evaluate_all("els=>els.filter(e=>e.getBoundingClientRect().width&&!e.disabled).map(e=>({label:e.innerText.trim(),href:e.getAttribute('href')})).filter(e=>/→|↗|Back|case file/i.test(e.label))")
   except Exception as e:row['error']=str(e)
 # Read-only supplementary checks: existing cases, real custom incident picker.
 origin=TXCC;page,state=page_for(origin)
 saved=json.loads((OUT/'browser-receipt.json').read_text());result={'analystFollowed':[],'profileHistory':[],'large':{},'errors':[]}
 for case in saved['cases']:
  incident=case['incident'];caseid=case['id']
  for view in VIEWS:
   try:
    source=url(origin,'analyst',view,incident,caseid)
    visit(page,source)
    links=page.locator('main button, main a').evaluate_all("els=>els.filter(e=>e.getBoundingClientRect().width&&!e.disabled).map(e=>({label:e.innerText.trim(),href:e.getAttribute('href'),border:getComputedStyle(e).borderStyle})).filter(e=>/→|↗|Back to previous|Open case file/.test(e.label))")
    for link in links:
     if any(x in link['label'].lower() for x in ['run reasoning','proof','propose','reset','download','submit','save','record','analyse','analyze']):continue
     row={'source':view,'incident':incident,'label':link['label'],'style':link['border'],'followed':False};result['analystFollowed'].append(row)
     try:
      visit(page,source);target=page.get_by_role('button',name=link['label'],exact=True).first
      if not target.count():target=page.get_by_role('link',name=link['label'],exact=True).first
      target.click(timeout=1500);row['followed']=True;page.wait_for_load_state('networkidle');row['landing']=snapshot(page)
     except Exception as e:row['error']=str(e)
   except Exception as e:result['errors'].append(str(e))
  # Actual C4 asset -> profile -> Back to previous, browser history and reload.
  try:
   source=url(origin,'command','consequence',incident,caseid,sector='water' if incident==saved['cases'][0]['incident'] else 'healthcare')
   visit(page,source);page.locator('main details').evaluate_all('els=>els.forEach(e=>e.open=true)');start=snapshot(page)
   page.get_by_role('button',name='Inspect current record in Analyst ↗',exact=True).first.click();page.wait_for_load_state('networkidle');profile=snapshot(page)
   page.get_by_role('button',name='← Back to previous view',exact=True).click();page.wait_for_load_state('networkidle');buttonBack=snapshot(page)
   visit(page,source);page.locator('main details').evaluate_all('els=>els.forEach(e=>e.open=true)');page.get_by_role('button',name='Inspect current record in Analyst ↗',exact=True).first.click();page.wait_for_load_state('networkidle');page.go_back(wait_until='networkidle');back=snapshot(page);page.go_forward(wait_until='networkidle');forward=snapshot(page);page.reload(wait_until='networkidle');reloaded=snapshot(page)
   result['profileHistory'].append({'source':start,'profile':profile,'buttonBack':buttonBack,'browserBack':back,'forward':forward,'reload':reloaded,'buttonPass':buttonBack['query'].get('view')==start['query'].get('view') and buttonBack['query'].get('mode')==start['query'].get('mode'),'browserPass':back['query'].get('view')==start['query'].get('view') and reloaded['query'].get('entity')==profile['query'].get('entity')})
  except Exception as e:result['profileHistory'].append({'error':str(e)})
 large=LARGE;lp,ls=page_for(large)
 scale={'prepared':json.loads(LARGE_METADATA.read_text()),'screens':[],'errors':[]}
 rr=get(large,'/v1/command/records');bb=get(large,'/v1/bootstrap');scale.update({'apiIncidentCount':len(rr['statewideIncidents']),'uniqueIncidentIds':len({i['id'] for i in rr['statewideIncidents']}),'entityCount':len(bb['entities']),'uniqueEntityIds':len({i['id'] for i in bb['entities']})})
 for view in ['command','cop','consequence']:
  try:
   visit(lp,url(large,'command',view,saved['cases'][0]['incident']));scale['screens'].append({'view':view,'landing':snapshot(lp),'text':lp.locator('main').inner_text()[:6000]})
   if view!='command':
    if view=='cop':
     lp.locator('.iv-select-trigger').click();options=lp.get_by_role('option')
    else:
     lp.locator('.c4-picker summary').click();options=lp.locator('.c4-picker button')
    scale.setdefault('menuCounts',{})[view]=options.count();scale['menuCount']=options.count();scale['optionIds']=options.all_text_contents()
    target='large-fixture-incident-49';options.filter(has_text=target).click();lp.wait_for_url(lambda u:parse_qs(urlsplit(u).query).get('incidentId')==[target]);scale.setdefault('switches',[]).append(snapshot(lp));lp.reload(wait_until='networkidle');scale.setdefault('reloads',[]).append(snapshot(lp))
  except Exception as e:scale['errors'].append(str(e))
 scale['pass']=not scale['errors'] and scale['apiIncidentCount']>=50 and scale['entityCount']>=300 and scale['apiIncidentCount']==scale['uniqueIncidentIds'] and scale['entityCount']==scale['uniqueEntityIds'] and all(scale.get('menuCounts',{}).get(view,0)>=50 for view in ['cop','consequence']) and len(scale.get('switches',[]))==2 and len(scale.get('reloads',[]))==2 and all(x['query'].get('incidentId')=='large-fixture-incident-49' for x in scale['switches']+scale['reloads'])
 scale['percentageCoverage']='not yet independently asserted';(OUT/'check-9-large.json').write_text(json.dumps(scale,indent=2))
 # Exercise real incident-search UI both directions.
 customer['search']=[]
 for current,selected,foreign in [(THIRD,customer['incident'],saved['cases'][0]['incident']),(TXCC,saved['cases'][0]['incident'],customer['incident'])]:
  cp,cs=page_for(current)
  try:
   visit(cp,url(current,'command','cop',selected));cp.locator('.iv-select-trigger').click();cp.get_by_role('combobox').fill(foreign)
   visible=cp.get_by_role('option').evaluate_all("els=>els.map(e=>e.querySelector('.iv-caption')?.textContent.split(' · ')[0].trim()||'')")
   owned={row['id'] for row in get(current,'/v1/command/records')['statewideIncidents']}
   customer['search'].append({'origin':current,'query':foreign,'matchingOptions':len(visible),'emptyState':cp.get_by_text('No matching open or monitoring incidents.',exact=True).count(),**customer_search_identity(visible,owned,foreign)})
  except Exception as e:customer['search'].append({'origin':current,'error':str(e)})
 (OUT/'check-2-customer.json').write_text(json.dumps(customer,indent=2))
 result['noExtraCases']=len(get(origin,'/v1/command/incidents')['incidents'])==2
 (OUT/'supplement-receipt.json').write_text(json.dumps(result,indent=2));browser.close();print(json.dumps({'analystFollowed':sum(x['followed'] for x in result['analystFollowed']),'profileHistory':result['profileHistory'],'largePass':scale['pass'],'largeErrors':scale['errors'],'extraCases':not result['noExtraCases']}))
