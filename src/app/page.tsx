import { ResidentTracker } from "@/components/resident-tracker";
import { demoScenarioSchema } from "@/components/demo-scenarios";
export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string; usb?: string; scenario?: string }> }) {
  const query = await searchParams;
  const demo = query.demo === "1";
  const usb = !demo && query.usb === "1" && process.env.NODE_ENV === "development" && process.env.GOGO_USB_PREVIEW === "1";
  return <ResidentTracker demo={demo} usb={usb} initialDemoScenario={demoScenarioSchema.catch("initial").parse(query.scenario)} />;
}
