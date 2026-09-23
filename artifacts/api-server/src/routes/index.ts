import { Router, type IRouter } from "express";
import factorsRouter from "./factors";
import healthRouter from "./health";
import marketRouter from "./market";
import hsiQualityRouter from "./hsi-quality";
import valuationRouter from "./valuation";
import valueRecoveryRouter from "./value-recovery";

const router: IRouter = Router();

router.use(healthRouter);
router.use(factorsRouter);
router.use(marketRouter);
router.use(hsiQualityRouter);
router.use(valuationRouter);
router.use(valueRecoveryRouter);

export default router;
