"use client";

import { useParams } from "next/navigation";
import FlowEditor from "@/components/flow/flow-editor";

export default function CampaignFlowPage() {
  const params = useParams<{ id: string }>();
  return <FlowEditor campaignId={params.id} />;
}
