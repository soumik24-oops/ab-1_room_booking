const AUTH_KEY = 'ab1AuthenticatedUser';
const SESSION_KEY = 'ab1SessionId';
const authGate = document.querySelector('#authGate');
const authForm = document.querySelector('#authForm');
const authEmail = document.querySelector('#authEmail');
const authError = document.querySelector('#authError');
const userEmail = document.querySelector('#userEmail');
const logout = document.querySelector('#logout');

function normalizeEmail(email){ return String(email || '').trim().toLowerCase(); }

async function authorize(email){
  const normalized = normalizeEmail(email);
  if(!/^[^\s@]+@iiserb\.ac\.in$/i.test(normalized)) {
    return {ok:false,message:'Access denied. Please use your @iiserb.ac.in institutional email address.'};
  }
  try {
    const res = await fetch('/api/access/check', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:normalized})
    });
    const data = await res.json();
    if(!res.ok || !data.allowed) return {ok:false,message:data.message || 'Access denied.'};
    return {ok:true,user:data.user,sessionId:data.sessionId};
  } catch(err) {
    return {ok:false,message:'Could not reach the authorization server. Start the booking server and try again.'};
  }
}

function showPortal(user){
  authGate.classList.add('hidden');
  userEmail.textContent = `${user.email} · ${user.department} · ${user.category}`;
}
function showAuth(message=''){
  authGate.classList.remove('hidden');
  authEmail.value='';
  authError.textContent=message;
  setTimeout(()=>authEmail.focus(),50);
}

authForm.onsubmit = async e => {
  e.preventDefault();
  authError.textContent='Checking the department authorization lists…';
  const result=await authorize(authEmail.value);
  if(!result.ok){authError.textContent=result.message;return;}
  sessionStorage.setItem(AUTH_KEY,JSON.stringify(result.user));
  sessionStorage.setItem(SESSION_KEY,result.sessionId);
  showPortal(result.user);
};

logout.onclick = () => {
  sessionStorage.removeItem(AUTH_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  showAuth();
};

(async()=>{
  const saved=sessionStorage.getItem(AUTH_KEY);
  if(saved){
    try {
      const user=JSON.parse(saved);
      const result=await authorize(user.email);
      if(result.ok){
        sessionStorage.setItem(AUTH_KEY,JSON.stringify(result.user));
        sessionStorage.setItem(SESSION_KEY,result.sessionId);
        showPortal(result.user);
      } else showAuth(result.message);
    } catch(_){ showAuth(); }
  } else showAuth();
})();

const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const today = new Date();
const iso = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const formatDate = d => d.toLocaleDateString(undefined, {weekday:'long', year:'numeric', month:'long', day:'numeric'});
const addMinutes = (time, mins) => { const [h,m] = time.split(':').map(Number); const total=h*60+m+mins; return `${pad(Math.floor(total/60))}:${pad(total%60)}`; };
const toMinutes = time => { const [h,m]=time.split(':').map(Number); return h*60+m; };

const rooms = [
  {id:'108', type:'Classroom', capacity:40, facilities:'Projector · Whiteboard · AC'},
  {id:'308', type:'Classroom', capacity:40, facilities:'Projector · Whiteboard · AC'},
  {id:'211', type:'Discussion Room', capacity:10, facilities:'Whiteboard · AC'},
  {id:'311', type:'Discussion Room', capacity:10, facilities:'Whiteboard · AC'},
  {id:'216', type:'Conference Room', capacity:16, facilities:'Projector · Conference table · AC'},
  {id:'316', type:'Conference Room', capacity:16, facilities:'Projector · Conference table · AC'}
];

let selectedRoom = '108';
let selected = new Date(today);
const datePicker = $('#datePicker');
const bookingDate = $('#bookingDate');
let bookings = JSON.parse(localStorage.getItem('ab1Bookings') || 'null') || [
  {id:crypto.randomUUID(), room:'108', date:iso(today), start:'10:00', end:'11:00', name:'Physics Research Group', purpose:'Weekly discussion'},
  {id:crypto.randomUUID(), room:'108', date:iso(today), start:'11:30', end:'12:30', name:'Mathematics Seminar', purpose:'Problem-solving session'},
  {id:crypto.randomUUID(), room:'211', date:iso(today), start:'14:00', end:'15:30', name:'Research Group', purpose:'Research meeting'}
];

function save(){ localStorage.setItem('ab1Bookings', JSON.stringify(bookings)); }
function room(){ return rooms.find(r=>r.id===selectedRoom); }
function getDayBookings(){ return bookings.filter(b=>b.room===selectedRoom && b.date===iso(selected)).sort((a,b)=>a.start.localeCompare(b.start)); }
function escapeHtml(value){ return String(value).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

function renderRooms(){
  $('#roomCount').textContent = `${rooms.length} rooms`;
  $('#roomGrid').innerHTML = rooms.map(r=>`<button class="room-tile ${r.id===selectedRoom?'selected':''}" data-room="${r.id}">
    <div class="room-tile-top"><span class="room-type">${escapeHtml(r.type)}</span><span class="room-number">${r.id}</span></div>
    <div class="room-capacity">Capacity ${r.capacity}</div>
    <div class="room-facilities">${escapeHtml(r.facilities)}</div>
  </button>`).join('');
  $('#roomGrid').querySelectorAll('.room-tile').forEach(el=>el.onclick=()=>{selectedRoom=el.dataset.room;renderRooms();render();});
}

function render(){
  const r=room();
  datePicker.value=iso(selected);
  $('#scheduleRoom').textContent=`${r.type} ${r.id}`;
  $('#selectedDateLabel').textContent=formatDate(selected);
  $('#modalTitle').textContent=`Reserve ${r.type} ${r.id}`;

  const day=getDayBookings();
  const startMinutes=9*60, endMinutes=19*60, slots=[];
  for(let m=startMinutes;m<endMinutes;m+=30) slots.push(`${pad(Math.floor(m/60))}:${pad(m%60)}`);

  $('#timeline').innerHTML=slots.map(t=>{
    const slotStart=toMinutes(t), slotEnd=slotStart+30;
    const booking=day.find(b=>toMinutes(b.start)<slotEnd && toMinutes(b.end)>slotStart);
    if(booking){
      const isFirst=toMinutes(booking.start)===slotStart;
      return `<div class="slot booked-slot"><div class="time">${t}</div><div class="event booked">${isFirst?`<strong>${escapeHtml(booking.name)}</strong><small>${booking.start}–${booking.end} · ${escapeHtml(booking.purpose)}</small>`:`<small class="continuation">Booked · ${booking.start}–${booking.end}</small>`}</div></div>`;
    }
    return `<div class="slot free-slot" data-time="${t}"><div class="time">${t}</div><button class="event available-event" type="button"><span class="available">Available · click to book</span></button></div>`;
  }).join('');

  $('#timeline').querySelectorAll('.free-slot').forEach(slot=>slot.addEventListener('click',()=>openBooking(slot.dataset.time)));
  const now=new Date(), current=now.toTimeString().slice(0,5);
  $('#roomStatus');
}

function openBooking(startTime){
  const r=room();
  bookingDate.value=iso(selected);
  $('#roomId').value=r.id;
  $('#startTime').value=startTime;
  $('#endTime').value=addMinutes(startTime,60);
  $('#modalSlot').textContent=`${formatDate(selected)} · ${startTime}–${addMinutes(startTime,60)}`;
  $('#formError').textContent='';
  $('#bookingModal').classList.remove('hidden');
  setTimeout(()=>$('#userName').focus(),50);
}
function close(){ $('#bookingModal').classList.add('hidden'); }

$('#closeBooking').onclick=close;
$('#bookingModal').addEventListener('click',e=>{if(e.target.id==='bookingModal')close();});
$('#prevDay').onclick=()=>{selected.setDate(selected.getDate()-1);render();};
$('#nextDay').onclick=()=>{selected.setDate(selected.getDate()+1);render();};
datePicker.onchange=()=>{selected=new Date(datePicker.value+'T12:00:00');render();};
$('#startTime').onchange=()=>{ if($('#startTime').value) $('#endTime').value=addMinutes($('#startTime').value,60); $('#modalSlot').textContent=`${formatDate(new Date(bookingDate.value+'T12:00:00'))} · ${$('#startTime').value}–${$('#endTime').value}`; };
$('#endTime').onchange=()=>{ $('#modalSlot').textContent=`${formatDate(new Date(bookingDate.value+'T12:00:00'))} · ${$('#startTime').value}–${$('#endTime').value}`; };

$('#bookingForm').onsubmit=e=>{
  e.preventDefault();
  const b={id:crypto.randomUUID(),room:$('#roomId').value,date:bookingDate.value,start:$('#startTime').value,end:$('#endTime').value,name:$('#userName').value.trim(),purpose:$('#purpose').value.trim()};
  if(!b.date||!b.start||!b.end||!b.name||!b.purpose){$('#formError').textContent='Please complete all fields.';return;}
  if(b.end<=b.start){$('#formError').textContent='End time must be after start time.';return;}
  if(toMinutes(b.start)%30!==0||toMinutes(b.end)%30!==0){$('#formError').textContent='Bookings must start and end on a 30-minute boundary.';return;}
  const conflict=bookings.some(x=>x.room===b.room&&x.date===b.date&&b.start<x.end&&b.end>x.start);
  if(conflict){$('#formError').textContent='That time overlaps an existing booking for this room.';return;}
  bookings.push(b);save();selected=new Date(b.date+'T12:00:00');render();close();e.target.reset();showToast(`${room().type} ${b.room} booked for ${b.start}–${b.end}.`);
};

function showToast(msg){const t=$('#toast');t.textContent=msg;t.classList.remove('hidden');t.classList.add('show');setTimeout(()=>{t.classList.add('hidden');t.classList.remove('show');},2800);}
renderRooms();render();
