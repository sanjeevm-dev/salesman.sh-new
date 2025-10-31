import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IExtractedData extends Document {
  _id: mongoose.Types.ObjectId;
  userId: string;
  agentId: mongoose.Types.ObjectId;
  sessionId: mongoose.Types.ObjectId;
  dataType: string;
  records: Array<Record<string, unknown>>;
  totalCount: number;
  extractedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ExtractedDataSchema = new Schema<IExtractedData>(
  {
    userId: { type: String, required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'Agent', required: true },
    sessionId: { type: Schema.Types.ObjectId, ref: 'AgentSession', required: true },
    dataType: { type: String, required: true },
    records: { type: Schema.Types.Mixed, required: true },
    totalCount: { type: Number, required: true },
    extractedAt: { type: Date, required: true },
  },
  {
    timestamps: true,
    collection: 'extracted_data',
  }
);

ExtractedDataSchema.index({ userId: 1, agentId: 1 });
ExtractedDataSchema.index({ userId: 1, sessionId: 1 });
ExtractedDataSchema.index({ userId: 1, dataType: 1 });
ExtractedDataSchema.index({ extractedAt: -1 });

const ExtractedData: Model<IExtractedData> = 
  mongoose.models.ExtractedData || mongoose.model<IExtractedData>('ExtractedData', ExtractedDataSchema);

export default ExtractedData;
