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
THIRD_METADATA=Path(os.environ['PART_B_THIRD_METADATA']);LARGE_METADATA=Path(os.environ['PART_B_LARGE_METADATA'])
VIEWS=['command','cop','cyber','consequence','coordination','uctf','case-file','entity-profile']
COMMAND=['command','cop','cyber','consequence','uctf','leadership','federation']
report={'candidateBeforeCommit':sys.argv[2],'matrix':[],'analyst':[],'cases':[],'history':[],'errors':[],'blocked':[],'coverageGaps':[]}
def get(origin,path):return json.load(urlopen(origin+path,timeout=20))
def customer_failure(context,error,trace):
 return {**context,'pass':False,'error':str(error) or type(error).__name__,'errorType':type(error).__name__,'traceback':trace}
def create_from_form(page,state,origin,form,before_ids,context):
 """Keep writes enabled until the real POST and resulting UI have completed."""
 state['allowCreate']=True
 try:
  with page.expect_response(lambda r:r.url==origin+'/v1/command/incidents' and r.request.method=='POST',timeout=20000) as pending:
   form.get_by_role('button',name='Open case',exact=True).click()
  response=pending.value
  context['createResponse']={'status':response.status,'body':response.text()}
  assert response.ok, f'Case-create POST returned {response.status}: {response.text()}'
  form.wait_for(state='hidden',timeout=20000)
  cases=get(origin,'/v1/command/incidents')['incidents'];context['caseIdsAfterCreate']=[c['id'] for c in cases]
  created=[c for c in cases if c['id'] not in before_ids]
  assert len(created)==1, f'Expected exactly one persisted new case; before={sorted(before_ids)!r}, after={context["caseIdsAfterCreate"]!r}'
  return created[0]
 finally:
  state['allowCreate']=False
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
 # TXCC no-case then one real explicit UI case creation per incident.
 origin=TXCC;page,state=page_for(origin)
 records=get(origin,'/v1/command/records');wanted=['INC-2026-1002-POH','TX-26-0412'];before=get(origin,'/v1/command/incidents')['incidents'];report['initialCaseIds']=[x['id'] for x in before];assert not before, 'Requires fresh empty disposable store: refuse duplicate case creation on rerun'
 for incident in wanted:
  try:
   audit_commands(page,origin,incident,None,'no-case')
   visit(page,url(origin,'analyst','command',incident));before_ids={c['id'] for c in get(origin,'/v1/command/incidents')['incidents']}
   state['allowCreate']=True
   page.locator('[data-alert-id]').first.get_by_role('button',name='Open case',exact=True).click()
   form=page.get_by_role('form',name='Open case from alert');form.get_by_label('Case title').fill('Disposable Part B '+incident)
   case=create_from_form(page,state,origin,form,before_ids,report);entity=case['contextSnapshot'].get('provider') or case['contextSnapshot'].get('facility') or case['contextSnapshot'].get('physicalAsset');entity=entity['id'] if entity else None
   report['cases'].append({'incident':incident,'id':case['id'],'eventId':case['eventId'],'createdExactlyOne':True,'uiAfterCreate':snapshot(page)})
   page.reload(wait_until='networkidle');report['cases'][-1]['afterReload']=snapshot(page)
   analyst_views(page,origin,incident,case['id'],entity);audit_commands(page,origin,incident,case['id'],'saved')
  except Exception as e:state['allowCreate']=False;report['errors'].append({'caseIncident':incident,'error':str(e)})
 report['finalCaseIds']=[c['id'] for c in get(origin,'/v1/command/incidents')['incidents']];report['caseCreateRequests']=state['writes'];report['noExtraCases']=len(report['finalCaseIds'])-len(report['initialCaseIds'])==2 and len(state['writes'])==2
 # A1 clear -> actual browser Back/Forward/reload.
 try:
  visit(page,url(origin,'analyst','command',wanted[0],sector='water',entity='poh-port'));start=snapshot(page)
  page.get_by_role('button',name='Clear incident filter',exact=True).click();cleared=snapshot(page);page.go_back(wait_until='networkidle');back=snapshot(page);page.go_forward(wait_until='networkidle');forward=snapshot(page);page.reload(wait_until='networkidle');reload=snapshot(page)
  report['history'].append({'start':start,'clear':cleared,'back':back,'forward':forward,'reload':reload,'pass':back['query'].get('incidentId')==wanted[0] and not any(k in reload['query'] for k in ['incident','incidentId','entity','sector'])})
 except Exception as e:report['history'].append({'error':str(e)})
 # Environment-scoped customer separation. Exact IDs, not substring name claims.
 ts=None;separation={'origin':THIRD,'metadataPath':str(THIRD_METADATA),'screens':[],'search':[],'pass':False}
 try:
  metadata=json.loads(THIRD_METADATA.read_text());incident=metadata['incidentId'];separation.update({'incident':incident,'customerId':metadata['customerId']})
  third=THIRD;tp,ts=page_for(third);tboot=get(third,'/v1/bootstrap');trecord=get(third,'/v1/command/records');xboot=get(origin,'/v1/bootstrap');xrecord=get(origin,'/v1/command/records')
  xid=ids(xboot)|ids(xrecord);tid=ids(tboot)|ids(trecord)
  separation.update({'boundary':'environment-scoped stores, NOT row-level tenancy or customer selector','originalIds':len(xid),'thirdIds':len(tid),'overlapIds':sorted(xid&tid),'api':{'thirdScenario':metadata['scenarioPath']}})
  thirdIncidentIds={i['id'] for i in trecord['statewideIncidents']};txIncidentIds={i['id'] for i in xrecord['statewideIncidents']}
  for current,pag,selected,foreign in [(third,tp,incident,txIncidentIds),(origin,page,wanted[0],thirdIncidentIds)]:
   for mode,views in [('command',COMMAND),('analyst',VIEWS[:6])]:
    for view in views:
     visit(pag,url(current,mode,view,selected));text=pag.locator('main').inner_text();found=[v for v in foreign if re.search(r'(?<![\w:-])'+re.escape(v)+r'(?![\w:-])',text)];separation['screens'].append({'origin':current,'mode':mode,'requested':view,'landing':snapshot(pag),'foreignIncidentIds':found})
   for inp in pag.locator('main input[type=search]').all():
    inp.fill(next(iter(foreign)));separation['search'].append({'origin':current,'foreignQuery':next(iter(foreign)),'visibleForeignIds':[v for v in foreign if re.search(r'(?<![\w:-])'+re.escape(v)+r'(?![\w:-])',pag.locator('main').inner_text())]})
  separation['pass']=not separation['overlapIds'] and all(not s['foreignIncidentIds'] for s in separation['screens']);(OUT/'check-2-customer.json').write_text(json.dumps(separation,indent=2))
  audit_commands(tp,third,incident,None,'third-no-case');analyst_views(tp,third,incident,None,metadata['sourceId'])
  visit(tp,url(third,'analyst','command',incident));oldids={c['id'] for c in get(third,'/v1/command/incidents')['incidents']};separation['caseIdsBeforeCreate']=sorted(oldids);assert not oldids, 'Requires fresh empty third-customer store'
  tp.locator('[data-alert-id]').first.get_by_role('button',name='Open case',exact=True).click()
  form=tp.get_by_role('form',name='Open case from alert');form.get_by_label('Case title').fill('Disposable third customer case')
  tc=create_from_form(tp,ts,third,form,oldids,separation)
  report['thirdCase']={'id':tc['id'],'incident':incident,'requests':ts['writes']};separation['savedCase']=report['thirdCase']
  analyst_views(tp,third,incident,tc['id'],metadata['sourceId']);audit_commands(tp,third,incident,tc['id'],'third-saved')
 except Exception as e:
  separation=customer_failure(separation,e,traceback.format_exc())
  if ts is not None:ts['allowCreate']=False;separation['createRequests']=ts['writes']
 finally:(OUT/'check-2-customer.json').write_text(json.dumps(separation,indent=2))
 # Actual durable scale fixture: API totals + select menu + last incident switching.
 try:
  large=LARGE;lp,ls=page_for(large);boot=get(large,'/v1/bootstrap');rr=get(large,'/v1/command/records');projection=get(large,'/v1/command/consequences?incidentId='+wanted[0]);inc=rr['statewideIncidents'];entities=boot['entities']
  scale={'productionTouched':False,'prepared':json.loads(LARGE_METADATA.read_text()),'apiIncidentCount':len(inc),'uniqueIncidentIds':len({r['id'] for r in inc}),'entityCount':len(entities),'uniqueEntityIds':len({r['id'] for r in entities}),'nodes':len(projection['nodes']),'cascadeCount':projection['cascadeCount'],'screens':[]}
  for view in ['command','cop','consequence']:
   visit(lp,url(large,'command',view,wanted[0]));row={'view':view,'landing':snapshot(lp),'selects':lp.locator('main select').evaluate_all('els=>els.map(e=>({label:e.getAttribute("aria-label"),count:e.options.length,value:e.value}))'),'text':lp.locator('main').inner_text()[:4500]};scale['screens'].append(row)
  lp.locator('.c4-picker summary').click();options=lp.locator('.c4-picker button');scale['options']=options.all_text_contents()
  target='large-fixture-incident-49';options.filter(has_text=target).click();lp.wait_for_url(lambda u:parse_qs(urlsplit(u).query).get('incidentId')==[target]);scale['lastSelection']=snapshot(lp);lp.reload(wait_until='networkidle');scale['reloadedSelection']=snapshot(lp)
  scale['pass']=len(inc)>=50 and len(entities)>=300 and len({r['id'] for r in inc})==len(inc) and len({r['id'] for r in entities})==len(entities) and scale['lastSelection']['query'].get('incidentId')==target and scale['reloadedSelection']['query'].get('incidentId')==target
  scale['percentageCoverage']='Not asserted: need DOM count-to-percentage denominator verification, not fixed labels.'
  (OUT/'check-9-large-preliminary.json').write_text(json.dumps(scale,indent=2))
 except Exception as e:(OUT/'check-9-large-preliminary.json').write_text(json.dumps({'error':str(e) or type(e).__name__,'traceback':traceback.format_exc()}))
 browser.close()
report['coverageGaps']=['Entity profile source-specific Back and all Analyst navigation links covered by supplement','not every sector/asset interactive layout expanded','computed solid Command-link assertions and percentage assertions incomplete']
(OUT/'browser-receipt.json').write_text(json.dumps(report,indent=2));print(json.dumps({'cases':report['cases'],'matrixRows':len(report['matrix']),'followed':sum(r['followed'] for r in report['matrix']),'analystViews':len(report['analyst']),'errors':report['errors'],'noExtraCases':report.get('noExtraCases')}))
