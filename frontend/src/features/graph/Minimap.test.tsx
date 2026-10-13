import {act,render,screen} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {beforeEach,expect,it,vi} from "vitest"
import {Minimap} from "./CytoscapeGraph"
import {notifyProjectOpened,notifyDatasetReplacing} from "@/lib/security/datasetBoundary"
import {openProject,startProject,resetProjectTraffic,updateProject} from "@/lib/api/endpoints"

const view={box:{x:0,y:0,w:100,h:100},nodes:[],view:{x:10,y:10,w:30,h:30}}
beforeEach(()=>{notifyProjectOpened();vi.unstubAllGlobals()})
it("defaults open, toggles with keyboard, and preserves the viewport when reopened",async()=>{
 const user=userEvent.setup();render(<Minimap view={view} onCenter={vi.fn()}/>);
 const map=screen.getByRole("img",{name:"그래프 미니맵"}),toggle=screen.getByRole("button",{name:"미니맵 접기"});
 expect(toggle).toHaveTextContent("−");expect(map).toBeVisible();
 await user.click(toggle);expect(toggle).toHaveTextContent("+");expect(toggle).toHaveAttribute("aria-expanded","false");expect(map).not.toBeVisible();
 toggle.focus();await user.keyboard("{Enter}");expect(map).toBeVisible();expect(map).toHaveAttribute("viewBox","0 0 100 100");
})
it("keeps the last choice across renderer remounts and traffic resets",async()=>{
 const user=userEvent.setup(),first=render(<Minimap view={view} onCenter={vi.fn()}/>);
 await user.click(screen.getByRole("button",{name:"미니맵 접기"}));first.unmount();
 render(<Minimap view={view} onCenter={vi.fn()}/>);
 expect(screen.getByRole("button",{name:"미니맵 펼치기"})).toBeVisible();
 act(()=>notifyDatasetReplacing());expect(screen.getByRole("button",{name:"미니맵 펼치기"})).toBeVisible();
 expect(sessionStorage.getItem("flowscope.graph.minimap-expanded")).toBe("false");
})
it.each([()=>openProject("same-project"),()=>startProject({name:"new",scope:"https://synthetic.test"})])("resets only after a project open/create succeeds",async request=>{
 const user=userEvent.setup();render(<Minimap view={view} onCenter={vi.fn()}/>);
 await user.click(screen.getByRole("button",{name:"미니맵 접기"}));
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{"message":"failed"}',{status:500})));
 await expect(request()).rejects.toThrow();expect(screen.getByRole("button",{name:"미니맵 펼치기"})).toBeVisible();
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{headers:{"Content-Type":"application/json"}})));
 await act(async()=>{await request()});expect(screen.getByRole("button",{name:"미니맵 접기"})).toBeVisible();
})
it("does not change the choice when project traffic or project details are updated",async()=>{
 const user=userEvent.setup();render(<Minimap view={view} onCenter={vi.fn()}/>);
 await user.click(screen.getByRole("button",{name:"미니맵 접기"}));
 vi.stubGlobal("fetch",vi.fn(async()=>new Response('{}',{headers:{"Content-Type":"application/json"}})));
 await act(async()=>{await resetProjectTraffic();await updateProject({name:"renamed",scope:"https://synthetic.test"})});
 expect(screen.getByRole("button",{name:"미니맵 펼치기"})).toBeVisible();
})
