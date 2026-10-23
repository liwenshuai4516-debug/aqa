/** Frozen U00 target. Product expectations below are declarations, not observations. */
export const optimizationScope = {
	version: "u00-1",
	roles: ["tester", "viewer"],
	features: [
		{ id: "search", assertions: ["query filters names", "reset restores first page"] },
		{ id: "edit", assertions: ["dialog opens and cancels without writes", "saved name survives reload"] },
		{ id: "details", assertions: ["tab selection changes panel", "details expansion changes visibility"] },
		{ id: "paging", assertions: ["two rows per page", "next and previous retain query"] },
		{ id: "permission", assertions: ["viewer cannot see Add", "tester can see Add"] },
		{ id: "states", assertions: ["loading precedes data", "no matches shows empty", "failure shows error"] },
	],
	initialNames: ["Alpha", "Beta", "Gamma"],
	sideEffects: "Only this origin's localStorage; no external request or server mutation.",
	cleanup: "Close owned browser contexts and fixture servers; each test uses a new origin.",
	budget: { actions: 60, milliseconds: 120000, completion: "All frozen assertions evidenced or explicitly blocked." },
};

export function optimizationPage({ discardPersistence = false } = {}) {
	return `<!doctype html><html lang="en"><title>UI optimization fixture u00-1</title>
<h1>Names</h1><p id="identity"></p>
<form id="search"><label>Query <input name="query"></label><button>Search</button><button type="reset">Reset</button></form>
<button id="add">Add</button><dialog><form id="edit"><label>Name <input name="name" required></label><button>Save</button><button type="button" id="cancel">Cancel</button></form></dialog>
<div role="tablist"><button role="tab" aria-selected="true" id="list-tab">List</button><button role="tab" aria-selected="false" id="about-tab">About</button></div>
<section role="tabpanel" id="list-panel"><p role="status"></p><ul></ul><button id="previous">Previous</button><span id="page"></span><button id="next">Next</button></section>
<section role="tabpanel" id="about-panel" hidden><details><summary>Details</summary><p>Fixture version u00-1</p></details></section>
<button id="failure">Simulate error</button><script>
const $=s=>document.querySelector(s),role=new URL(location.href).searchParams.get('role')||'tester';
$('#identity').textContent='Role: '+role;$('#add').hidden=role!=='tester';
const initial=${JSON.stringify(optimizationScope.initialNames)},names=JSON.parse(localStorage.getItem('names')||JSON.stringify(initial));
let query='',page=0,timer;
function render(fail=false){clearTimeout(timer);$('[role=status]').textContent='Loading';$('ul').replaceChildren();
 timer=setTimeout(()=>{const rows=names.filter(n=>n.toLowerCase().includes(query.toLowerCase()));
 $('[role=status]').textContent=fail?'Error loading names':rows.length?'Ready':'Empty';
 if(!fail)$('ul').replaceChildren(...rows.slice(page*2,page*2+2).map(n=>{const li=document.createElement('li');li.textContent=n;return li}));
 $('#previous').disabled=page===0;$('#next').disabled=(page+1)*2>=rows.length;$('#page').textContent=String(page+1);
 },80);
}
$('#search').onsubmit=e=>{e.preventDefault();query=new FormData(e.target).get('query');page=0;render()};
$('#search').onreset=()=>{query='';page=0;render()};
$('#previous').onclick=()=>{page--;render()};$('#next').onclick=()=>{page++;render()};
$('#add').onclick=()=>$('dialog').showModal();$('#cancel').onclick=()=>$('dialog').close();
$('#edit').onsubmit=e=>{e.preventDefault();if(role!=='tester')return;names.push(new FormData(e.target).get('name'));
 ${discardPersistence ? "localStorage.removeItem('names')" : "localStorage.setItem('names',JSON.stringify(names))"};$('dialog').close();render()};
for(const id of ['list','about'])$('#'+id+'-tab').onclick=()=>{for(const name of ['list','about']){
 $('#'+name+'-tab').setAttribute('aria-selected',String(name===id));$('#'+name+'-panel').hidden=name!==id}};
$('#failure').onclick=()=>render(true);render();
</script></html>`;
}
