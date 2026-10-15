import { useCallback, useState } from "react"
import Workspace from "./Workspace"
import OpeningIntro from "./OpeningIntro"

export default function App() {
  const [introducing, setIntroducing] = useState(true)
  const finishIntro = useCallback(() => setIntroducing(false), [])
  return <>
    <div inert={introducing} aria-hidden={introducing ? true : undefined}><Workspace /></div>
    {introducing && <OpeningIntro onFinish={finishIntro} />}
  </>
}
