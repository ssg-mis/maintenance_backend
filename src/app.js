const express=require("express");
const cors=require("cors");
const helmet=require("helmet");
const morgan=require("morgan");
require("dotenv").config();

const auth=require("./routes/auth");
const machines=require("./routes/machines");
const tasks=require("./routes/tasks");
const logs=require("./routes/logs");
const breakdowns=require("./routes/breakdowns");
const alerts=require("./routes/alerts");
const team=require("./routes/team");
const users=require("./routes/users");
const approvals=require("./routes/approvals");
const reports=require("./routes/reports");
const complaints=require("./routes/complaints");
const {notFound,errorHandler}=require("./middleware/error");

const app=express();

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map(s=>s.trim()) : true,
  credentials: true
}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(morgan(process.env.NODE_ENV==="production"?"combined":"dev"));

app.get("/health",(req,res)=>res.json({success:true,status:"ok",service:"maintenance-management-backend",timestamp:new Date().toISOString()}));

app.use("/api/auth",auth);
app.use("/api/users",users);
app.use("/api/machines",machines);
app.use("/api/tasks",tasks);
app.use("/api/daily-logs",logs);
app.use("/api/breakdowns",breakdowns);
app.use("/api/alerts",alerts);
app.use("/api/team",team);
app.use("/api/admin/approvals",approvals);
app.use("/api/reports",reports);
app.use("/api/complaints",complaints);

app.use(notFound);
app.use(errorHandler);

module.exports=app;
